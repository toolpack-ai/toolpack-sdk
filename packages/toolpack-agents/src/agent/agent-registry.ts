import type { Toolpack } from 'toolpack-sdk';
import type { AgentInput, AgentOutput, AgentRegistration, IAgentRegistry, ChannelInterface, AgentInstance } from './types.js';

/**
 * Registry for agents and their associated channels.
 * Passed to Toolpack.init() to wire up agent handling.
 */
export class AgentRegistry implements IAgentRegistry {
  private registrations: AgentRegistration[];
  private instances: Map<string, AgentInstance> = new Map();
  private channels: Map<string, ChannelInterface> = new Map();

  /**
   * Create a new agent registry with the given registrations.
   * @param registrations Array of agent registrations with their channels
   */
  constructor(registrations: AgentRegistration[]) {
    this.registrations = registrations;
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
          // Track which channel triggered this invocation
          agent._triggeringChannel = channel.name;

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
  }
}
