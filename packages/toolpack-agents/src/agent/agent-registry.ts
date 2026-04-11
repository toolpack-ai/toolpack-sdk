import { randomUUID } from 'crypto';
import type { Toolpack } from 'toolpack-sdk';
import type { AgentInput, AgentOutput, AgentRegistration, IAgentRegistry, ChannelInterface, AgentInstance, PendingAsk } from './types.js';

/**
 * Registry for agents and their associated channels.
 * Passed to Toolpack.init() to wire up agent handling.
 */
export class AgentRegistry implements IAgentRegistry {
  private registrations: AgentRegistration[];
  private instances: Map<string, AgentInstance> = new Map();
  private channels: Map<string, ChannelInterface> = new Map();

  /** In-memory store for pending human-in-the-loop questions. Stored as Map<conversationId, PendingAsk[]> */
  private pendingAsks: Map<string, PendingAsk[]> = new Map();

  /** Conversation locks to prevent race conditions on concurrent messages */
  private conversationLocks: Map<string, Promise<void>> = new Map();

  /**
   * Create a new agent registry with the given registrations.
   * @param registrations Array of agent registrations with their channels
   */
  constructor(registrations: AgentRegistration[]) {
    this.registrations = registrations;
  }

  /**
   * Acquire a lock for a conversation to prevent concurrent processing.
   * @param conversationId The conversation to lock
   * @returns A function to release the lock
   */
  private async acquireConversationLock(conversationId: string): Promise<() => void> {
    // Wait for any existing lock to be released
    while (this.conversationLocks.has(conversationId)) {
      try {
        await this.conversationLocks.get(conversationId);
      } catch {
        // Previous operation failed, but we can still proceed
      }
    }

    // Create a new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.conversationLocks.set(conversationId, lockPromise);

    return () => {
      this.conversationLocks.delete(conversationId);
      releaseLock!();
    };
  }

  /**
   * Start the registry - instantiate agents and start channel listeners.
   * Called by Toolpack.init() during SDK initialization.
   * @param toolpack The initialized Toolpack instance
   */
  start(toolpack: Toolpack): void {
    for (const reg of this.registrations) {
      // Instantiate the agent with the shared Toolpack instance
      const agent = new reg.agent(toolpack);

      // Wire up the registry reference for sendTo() support
      agent._registry = this;

      // Store the instance
      this.instances.set(agent.name, agent);

      // Set up each channel for this agent
      for (const channel of reg.channels) {
        // Register named channels for sendTo() routing
        if (channel.name) {
          this.channels.set(channel.name, channel);
        }

        // Set up the message handler
        channel.onMessage(async (input: AgentInput) => {
          // Skip processing if no conversationId (can't lock without it)
          if (!input.conversationId) {
            console.warn(`[AgentRegistry] Message received without conversationId - skipping`);
            return;
          }

          // Acquire lock for this conversation to prevent race conditions
          const releaseLock = await this.acquireConversationLock(input.conversationId);

          try {
            // Track which channel triggered this invocation
            agent._triggeringChannel = channel.name;

            // Mark if this is a trigger channel (channels with no human recipient cannot use this.ask())
            agent._isTriggerChannel = channel.isTriggerChannel;

            // Set conversation ID for this invocation
            agent._conversationId = input.conversationId;

            // Invoke the agent
            const result = await agent.invokeAgent(input);

            // Send result back through the triggering channel
            // Include conversationId and context in metadata for channels that need it:
            // - WebhookChannel: uses conversationId for session matching
            // - SlackChannel: uses threadTs for threaded replies
            await channel.send({
              output: result.output,
              metadata: {
                ...result.metadata,
                conversationId: input.conversationId,
                ...input.context, // Pass threadTs, chatId, etc. for channel-specific routing
              },
            });
          } catch (error) {
            // Handle errors gracefully - send error message back to user
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`[AgentRegistry] Error in agent invocation: ${errorMessage}`);

            // Try to send error to the channel if possible
            try {
              await channel.send({
                output: `Error: ${errorMessage}`,
                metadata: {
                  conversationId: input.conversationId,
                  error: true,
                  ...input.context,
                },
              });
            } catch (sendError) {
              // If we can't send the error, just log it
              console.error(`[AgentRegistry] Failed to send error to channel: ${sendError}`);
            }
          } finally {
            // Always release the lock
            releaseLock();
          }
        });

        // Start listening for messages
        channel.listen();
      }
    }
  }

  /**
   * Send output to a named channel.
   * Used by BaseAgent.sendTo() for conditional output routing.
   * @param channelName The registered name of the target channel
   * @param output The output to send
   */
  async sendTo(channelName: string, output: AgentOutput): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`No channel registered with name "${channelName}"`);
    }
    await channel.send(output);
  }

  /**
   * Get a registered agent instance by name.
   * @param name The agent name
   * @returns The agent instance or undefined if not found
   */
  getAgent(name: string): AgentInstance | undefined {
    return this.instances.get(name);
  }

  /**
   * Get all registered agent instances.
   * @returns Array of agent instances
   */
  getAllAgents(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get a registered channel by name.
   * @param name The channel name
   * @returns The channel instance or undefined if not found
   */
  getChannel(name: string): ChannelInterface | undefined {
    return this.channels.get(name);
  }

  /**
   * Stop all channels and clean up resources.
   * Called when shutting down.
   */
  async stop(): Promise<void> {
    // Stop all channels if they have a stop method
    for (const channel of this.channels.values()) {
      if ('stop' in channel && typeof (channel as { stop?: () => Promise<void> }).stop === 'function') {
        await (channel as { stop: () => Promise<void> }).stop();
      }
    }

    this.instances.clear();
    this.channels.clear();
    this.pendingAsks.clear();

    // Clear all conversation locks
    this.conversationLocks.clear();
  }

  // --- PendingAsksStore Methods ---

  /**
   * Get the current pending ask for a conversation.
   * Returns the first pending ask in the queue for this conversation.
   * Automatically cleans up expired asks.
   * @param conversationId The conversation identifier
   * @returns The pending ask or undefined if none
   */
  getPendingAsk(conversationId: string): PendingAsk | undefined {
    const asks = this.pendingAsks.get(conversationId);
    if (!asks || asks.length === 0) {
      return undefined;
    }

    // Clean up expired asks from the front of the queue
    const now = new Date();
    while (asks.length > 0) {
      const front = asks[0];
      if (front.expiresAt && front.expiresAt < now) {
        // Ask has expired, remove it
        asks.shift();
      } else {
        break;
      }
    }

    if (asks.length === 0) {
      this.pendingAsks.delete(conversationId);
      return undefined;
    }

    return asks[0];
  }

  /**
   * Check if there are any pending asks for a conversation.
   * Automatically cleans up expired asks.
   * @param conversationId The conversation identifier
   * @returns true if there are pending asks
   */
  hasPendingAsks(conversationId: string): boolean {
    const asks = this.pendingAsks.get(conversationId);
    if (!asks || asks.length === 0) {
      return false;
    }

    // Clean up expired asks
    const now = new Date();
    const validAsks = asks.filter(a => !a.expiresAt || a.expiresAt >= now);

    if (validAsks.length === 0) {
      this.pendingAsks.delete(conversationId);
      return false;
    }

    // Update the stored asks if we removed any
    if (validAsks.length !== asks.length) {
      this.pendingAsks.set(conversationId, validAsks);
    }

    return validAsks.some(a => a.status === 'pending');
  }

  /**
   * Clean up all expired asks across all conversations.
   * @returns Number of expired asks removed
   */
  cleanupExpiredAsks(): number {
    let removedCount = 0;
    const now = new Date();

    for (const [conversationId, asks] of this.pendingAsks.entries()) {
      const validAsks = asks.filter(a => !a.expiresAt || a.expiresAt >= now);
      removedCount += asks.length - validAsks.length;

      if (validAsks.length === 0) {
        this.pendingAsks.delete(conversationId);
      } else if (validAsks.length !== asks.length) {
        this.pendingAsks.set(conversationId, validAsks);
      }
    }

    return removedCount;
  }

  /**
   * Add a new pending ask to the queue.
   * Questions are queued per conversationId and sent sequentially.
   * @param ask The ask data (without id, askedAt, retries, status)
   * @returns The created PendingAsk with id and status
   */
  addPendingAsk(
    ask: Omit<PendingAsk, 'id' | 'askedAt' | 'retries' | 'status'>
  ): PendingAsk {
    const pendingAsk: PendingAsk = {
      ...ask,
      id: randomUUID(),
      askedAt: new Date(),
      retries: 0,
      status: 'pending',
    };

    const existing = this.pendingAsks.get(ask.conversationId);
    if (existing) {
      existing.push(pendingAsk);
    } else {
      this.pendingAsks.set(ask.conversationId, [pendingAsk]);
    }

    return pendingAsk;
  }

  /**
   * Increment the retry count for a pending ask.
   * Used when an answer is insufficient and needs to be re-asked.
   * @param id The ask id
   * @returns The updated retry count, or undefined if ask not found
   */
  incrementRetries(id: string): number | undefined {
    for (const asks of this.pendingAsks.values()) {
      const ask = asks.find(a => a.id === id);
      if (ask) {
        ask.retries += 1;
        return ask.retries;
      }
    }
    return undefined;
  }

  /**
   * Resolve a pending ask with an answer.
   * Marks the ask as answered and dequeues it, then sends the next ask if any.
   * @param id The ask id
   * @param answer The human's answer
   */
  async resolvePendingAsk(id: string, answer: string): Promise<void> {
    // Find the ask in any conversation queue
    for (const [conversationId, asks] of this.pendingAsks.entries()) {
      const index = asks.findIndex(a => a.id === id);
      if (index !== -1) {
        // Mark as answered
        asks[index].status = 'answered';
        asks[index].answer = answer;

        // Get the channel name before removing
        const channelName = asks[index].channelName;

        // Remove from queue (dequeue)
        asks.splice(index, 1);

        // If there are more pending asks in this conversation, send the next one automatically
        if (asks.length > 0) {
          const nextAsk = asks[0];
          // Validate channelName before sending
          if (channelName && channelName.trim() !== '') {
            try {
              await this.sendTo(channelName, { output: nextAsk.question });
            } catch (error) {
              console.error(`[AgentRegistry] Failed to auto-send next ask: ${error instanceof Error ? error.message : 'Unknown error'}`);
              // Ask stays in queue - will be sent on next user interaction
            }
          } else {
            console.warn(`[AgentRegistry] Cannot auto-send next ask: channelName is empty for conversation ${conversationId}`);
          }
        }

        if (asks.length === 0) {
          this.pendingAsks.delete(conversationId);
        }
        return;
      }
    }

    // Ask not found - throw error
    throw new Error(`Pending ask with id "${id}" not found`);
  }
}
