import { EventEmitter } from 'events';
import type { Toolpack } from 'toolpack-sdk';
import type { Knowledge } from '@toolpack-sdk/knowledge';
import { AgentInput, AgentResult, AgentRunOptions, WorkflowStep, IAgentRegistry, PendingAsk } from './types.js';
import { AgentError } from './errors.js';

/**
 * Abstract base class for all agents.
 * Extend this to create custom agents with specific behaviors.
 */
export abstract class BaseAgent<TIntent extends string = string> extends EventEmitter {
  // --- Required properties (must be set by subclasses) ---
  /** Unique agent identifier */
  abstract name: string;

  /** Human-readable description of what this agent does */
  abstract description: string;

  /** Mode this agent runs in (from toolpack-sdk modes) */
  abstract mode: string;

  // --- Optional identity properties ---
  /** System prompt injected on every run */
  systemPrompt?: string;

  /** Provider override (e.g., 'anthropic', 'openai') - inherits from Toolpack if not set */
  provider?: string;

  /** Model override - inherits from provider default if not set */
  model?: string;

  // --- Optional behavior properties ---
  /** Workflow configuration merged on top of mode config */
  workflow?: Record<string, unknown>;

  /** Knowledge base for this agent - auto-injected as knowledge_search tool in run() */
  knowledge?: Knowledge;

  // --- Internal references (set by AgentRegistry) ---
  /** Reference to the registry for channel routing */
  _registry?: IAgentRegistry;

  /** Name of the channel that triggered this invocation */
  _triggeringChannel?: string;

  /** Current conversation ID for this invocation */
  _conversationId?: string;

  /** Whether the triggering channel is a trigger channel (ScheduledChannel has no human recipient) */
  _isTriggerChannel?: boolean;

  /**
   * Constructor receives the shared Toolpack instance.
   * @param toolpack The Toolpack SDK instance
   */
  constructor(protected readonly toolpack: Toolpack) {
    super();
  }

  /**
   * Main entry point for agent invocation.
   * Implement this to handle incoming messages and route to appropriate logic.
   * @param input The normalized input from the channel
   * @returns The agent's result
   */
  abstract invokeAgent(input: AgentInput<TIntent>): Promise<AgentResult>;

  /**
   * Execute the agent using the Toolpack SDK.
   * This is the execution engine that bridges agents to the SDK.
   * @param message The message to process
   * @param options Optional overrides for this run
   * @returns The execution result
   */
  protected async run(message: string, options?: AgentRunOptions): Promise<AgentResult> {
    // Note: options can be used for per-run workflow overrides in future
    void options;

    // Fire lifecycle hooks and emit events
    await this.onBeforeRun({ message, conversationId: this._conversationId } as AgentInput<TIntent>);
    this.emit('agent:start', { message });

    try {
      // Set the agent's mode on the toolpack instance
      // This configures the workflow, system prompt, and available tools
      this.toolpack.setMode(this.mode);

      // Build messages array with conversation history if available
      const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

      // Fetch and inject conversation history from knowledge base when knowledge and conversationId are set
      if (this.knowledge && this._conversationId) {
        try {
          const historyResults = await this.knowledge.query(
            `conversation ${this._conversationId}`,
            {
              limit: 10,
              filter: { conversationId: this._conversationId, type: 'conversation_message' },
            }
          );
          // Sort by timestamp and convert to messages
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const historyMessages = historyResults
            .sort((a, b) => {
              const aTime = (a.chunk.metadata?.timestamp as string) || '';
              const bTime = (b.chunk.metadata?.timestamp as string) || '';
              return aTime.localeCompare(bTime);
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((result) => {
              // Only include messages with a valid role (user or assistant)
              const role = result.chunk.metadata?.role as string | undefined;
              return role === 'user' || role === 'assistant';
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((result) => ({
              role: result.chunk.metadata?.role as 'user' | 'assistant',
              content: result.chunk.content,
            }));
          messages.push(...historyMessages);
        } catch {
          // If knowledge query fails, continue without history
        }
      }

      messages.push({ role: 'user' as const, content: message });

      // Build tools array with knowledge search if available
      // Convert KnowledgeTool to SDK ToolCallRequest format
      const knowledgeTool = this.knowledge?.toTool();
      const tools = knowledgeTool
        ? [{
            type: 'function' as const,
            function: {
              name: knowledgeTool.name,
              description: knowledgeTool.description,
              parameters: knowledgeTool.parameters,
            },
          }]
        : undefined;

      // Build the completion request
      const request = {
        messages,
        model: this.model || '', // Empty string lets the adapter use defaults
        tools,
      };

      // Call toolpack.generate() with per-agent provider override
      const result = await this.toolpack.generate(request, this.provider);

      // Store the exchange in knowledge base when knowledge and conversationId are set
      if (this.knowledge && this._conversationId) {
        try {
          const timestamp = new Date().toISOString();
          // Store user message
          await this.knowledge.add(message, {
            conversationId: this._conversationId,
            type: 'conversation_message',
            role: 'user',
            agentName: this.name,
            timestamp,
          });
          // Store agent response
          await this.knowledge.add(result.content || '', {
            conversationId: this._conversationId,
            type: 'conversation_message',
            role: 'assistant',
            agentName: this.name,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // If knowledge storage fails, continue without crashing
        }
      }

      // Convert SDK result to AgentResult
      const agentResult: AgentResult = {
        output: result.content || '',
        steps: this.extractSteps(result),
        metadata: result.usage ? { usage: result.usage } : undefined,
      };

      // Fire completion hooks and emit events
      await this.onComplete(agentResult);
      this.emit('agent:complete', agentResult);

      return agentResult;
    } catch (error) {
      // Fire error hooks and emit events
      await this.onError(error as Error);
      this.emit('agent:error', error);
      throw error;
    }
  }

  /**
   * Send a message to a named channel.
   * The channel must be registered with a name in AgentRegistry.
   * @param channelName The registered name of the target channel
   * @param message The message to send
   */
  protected async sendTo(channelName: string, message: string): Promise<void> {
    if (!this._registry) {
      throw new Error('Agent not registered - _registry not set');
    }
    await this._registry.sendTo(channelName, { output: message });
  }

  /**
   * Ask the user a question and pause execution.
   * Phase 2 implementation: Enqueues question in PendingAsksStore and returns AgentResult.
   * The answer arrives in the next invokeAgent() call via getPendingAsk().
   * @param question The question to ask the user
   * @param options Optional configuration for the ask
   * @returns AgentResult indicating the agent is waiting for human input
   */
  protected async ask(
    question: string,
    options?: {
      context?: Record<string, unknown>;
      maxRetries?: number;
      expiresIn?: number;
    }
  ): Promise<AgentResult> {
    if (!this._registry) {
      throw new AgentError('Agent not registered - cannot use ask()');
    }

    if (!this._conversationId) {
      throw new AgentError('No conversationId available - ask() requires a conversation channel');
    }

    // Check if this is a trigger channel (cannot ask humans from trigger channels)
    if (this._isTriggerChannel) {
      throw new AgentError(
        'this.ask() called from a trigger channel (ScheduledChannel). ' +
          'Trigger channels have no human recipient — use a conversation channel (Slack, Telegram, Webhook) instead.'
      );
    }

    // Validate triggering channel is available
    if (!this._triggeringChannel || this._triggeringChannel.trim() === '') {
      throw new AgentError(
        'Cannot use ask() - no triggering channel available. ' +
          'The channel must have a name registered with AgentRegistry.'
      );
    }

    // Create pending ask
    const pendingAsk = this._registry.addPendingAsk({
      conversationId: this._conversationId,
      agentName: this.name,
      question,
      context: options?.context ?? {},
      maxRetries: options?.maxRetries ?? 2,
      expiresAt: options?.expiresIn ? new Date(Date.now() + options.expiresIn) : undefined,
      channelName: this._triggeringChannel,
    });

    // Send question to triggering channel
    await this.sendTo(this._triggeringChannel, question);

    // Return AgentResult indicating we're waiting for human input
    return {
      output: question,
      metadata: {
        waitingForHuman: true,
        askId: pendingAsk.id,
      },
    };
  }

  /**
   * Get the current pending ask for a conversation.
   * Returns the first pending ask in the queue, or null if none.
   * @param conversationId Optional conversation ID (defaults to current conversation)
   * @returns The pending ask or null
   */
  protected getPendingAsk(conversationId?: string): PendingAsk | null {
    if (!this._registry) {
      return null;
    }
    const convId = conversationId ?? this._conversationId;
    if (!convId) {
      return null;
    }
    return this._registry.getPendingAsk(convId) ?? null;
  }

  /**
   * Resolve a pending ask with an answer.
   * Marks the ask as answered and dequeues it, then sends the next ask if any.
   * @param id The ask id
   * @param answer The human's answer
   */
  protected async resolvePendingAsk(id: string, answer: string): Promise<void> {
    if (!this._registry) {
      throw new AgentError('Agent not registered - cannot resolve ask');
    }
    await this._registry.resolvePendingAsk(id, answer);
  }

  /**
   * Evaluate if an answer sufficiently addresses a question.
   * Uses simpleValidation callback if provided, otherwise uses LLM.
   * @param question The original question
   * @param answer The human's answer
   * @param options Optional configuration
   * @returns true if the answer is sufficient
   */
  protected async evaluateAnswer(
    question: string,
    answer: string,
    options?: {
      simpleValidation?: (answer: string) => boolean;
    }
  ): Promise<boolean> {
    // If simple validation is provided, use it (no LLM call)
    if (options?.simpleValidation) {
      return options.simpleValidation(answer);
    }

    // Otherwise use LLM to evaluate
    const result = await this.run(
      `Evaluate if this answer sufficiently addresses the question.\n\nQuestion: "${question}"\nAnswer: "${answer}"\n\nIs this answer sufficient? Reply with ONLY "yes" or "no".`,
      { workflow: { mode: 'single-shot' } }
    );

    return result.output.toLowerCase().trim().startsWith('yes');
  }

  /**
   * Handle a pending ask reply with automatic retry logic.
   * This helper implements the state machine pattern for human-in-the-loop:
   * 1. Evaluates if the answer is sufficient
   * 2. If insufficient and retries remain: re-asks with context preserved
   * 3. If insufficient and maxRetries exceeded: resolves with '__insufficient__' and returns fallback
   * 4. If sufficient: resolves the ask and returns the answer for continuing the task
   *
   * @param pending The pending ask to handle
   * @param reply The human's reply
   * @param onSufficient Callback when answer is sufficient (receives answer, should continue task)
   * @param onInsufficient Optional callback when max retries exceeded (default: returns skipped result)
   * @returns AgentResult from either re-asking or continuing the task
   *
   * @example
   * ```ts
   * async invokeAgent(input: AgentInput): Promise<AgentResult> {
   *   const pending = this.getPendingAsk();
   *   if (pending) {
   *     return this.handlePendingAsk(
   *       pending,
   *       input.message ?? '',
   *       async (answer) => {
   *         // Continue with the task using the answer
   *         return this.run(`Continue with: ${answer}`);
   *       }
   *     );
   *   }
   *   // ... normal execution
   * }
   * ```
   */
  protected async handlePendingAsk(
    pending: PendingAsk,
    reply: string,
    onSufficient: (answer: string) => Promise<AgentResult> | AgentResult,
    onInsufficient?: () => Promise<AgentResult> | AgentResult
  ): Promise<AgentResult> {
    // Check if answer is sufficient
    const sufficient = await this.evaluateAnswer(pending.question, reply, {
      simpleValidation: (a) => a.trim().length > 3, // Default: reject empty/one-word
    });

    if (sufficient) {
      // Answer is good - resolve the ask and continue
      await this.resolvePendingAsk(pending.id, reply);
      return onSufficient(reply);
    }

    // Answer is insufficient - check retry limit
    if (pending.retries >= pending.maxRetries) {
      // Max retries exceeded - resolve with special marker and return fallback
      await this.resolvePendingAsk(pending.id, '__insufficient__');

      // Notify user
      if (this._triggeringChannel) {
        await this.sendTo(
          this._triggeringChannel,
          'I was unable to get enough information to proceed. Skipping this step.'
        );
      }

      // Return fallback result
      if (onInsufficient) {
        return onInsufficient();
      }

      return {
        output: 'Step skipped due to insufficient input.',
        metadata: { skipped: true, askId: pending.id },
      };
    }

    // Can retry - increment counter and re-ask
    this._registry?.incrementRetries(pending.id);

    return this.ask(
      `I need a bit more clarity on: "${pending.question}". Could you provide more details?`,
      {
        context: pending.context,
        maxRetries: pending.maxRetries,
      }
    );
  }

  /**
   * Delegate a task to another agent by name (fire-and-forget).
   * The target agent will be invoked asynchronously without waiting for the result.
   *
   * @param agentName The name of the target agent
   * @param input Partial input for the agent (conversationId and delegatedBy will be added automatically)
   * @returns Promise that resolves when the delegation is initiated (not when complete)
   *
   * @example
   * ```ts
   * // Fire-and-forget delegation
   * await this.delegate('email-agent', {
   *   message: 'Send weekly report',
   *   intent: 'send_email'
   * });
   * ```
   */
  protected async delegate(
    agentName: string,
    input: Partial<AgentInput>
  ): Promise<void> {
    if (!this._registry) {
      throw new AgentError('Agent not registered - cannot use delegate()');
    }

    const fullInput: AgentInput = {
      message: input.message,
      intent: input.intent,
      data: input.data,
      context: {
        ...(input.context || {}),
        delegatedBy: this.name,
      },
      conversationId: input.conversationId || this._conversationId || `delegation-${Date.now()}`,
    };

    // Get transport from registry (will use LocalTransport by default)
    const transport = (this._registry as any)._transport;
    if (!transport) {
      throw new AgentError('No transport configured for delegation');
    }

    // Fire and forget - don't await
    transport.invoke(agentName, fullInput).catch((error: Error) => {
      console.error(`[${this.name}] Delegation to ${agentName} failed:`, error.message);
    });
  }

  /**
   * Delegate a task to another agent and wait for the result (synchronous delegation).
   * The target agent will be invoked and this method will wait for its completion.
   *
   * @param agentName The name of the target agent
   * @param input Partial input for the agent (conversationId and delegatedBy will be added automatically)
   * @returns The result from the target agent
   *
   * @example
   * ```ts
   * // Wait for result
   * const result = await this.delegateAndWait('data-agent', {
   *   message: 'Generate weekly leads report',
   *   intent: 'generate_report'
   * });
   * console.log('Report:', result.output);
   * ```
   */
  protected async delegateAndWait(
    agentName: string,
    input: Partial<AgentInput>
  ): Promise<AgentResult> {
    if (!this._registry) {
      throw new AgentError('Agent not registered - cannot use delegateAndWait()');
    }

    const fullInput: AgentInput = {
      message: input.message,
      intent: input.intent,
      data: input.data,
      context: {
        ...(input.context || {}),
        delegatedBy: this.name,
      },
      conversationId: input.conversationId || this._conversationId || `delegation-${Date.now()}`,
    };

    // Get transport from registry (will use LocalTransport by default)
    const transport = (this._registry as any)._transport;
    if (!transport) {
      throw new AgentError('No transport configured for delegation');
    }

    return await transport.invoke(agentName, fullInput);
  }

  // --- Lifecycle hooks (override in subclasses) ---

  /**
   * Called before run() starts.
   * @param input The input that will be processed
   */
  async onBeforeRun(_input: AgentInput<TIntent>): Promise<void> {
    // Override in subclass for custom pre-run logic
  }

  /**
   * Called after each workflow step completes.
   * Also emits 'agent:step' event.
   * @param step The completed workflow step
   */
  async onStepComplete(_step: WorkflowStep): Promise<void> {
    // Override in subclass for custom step handling
  }

  /**
   * Called when run() completes successfully.
   * Also emits 'agent:complete' event.
   * @param result The final result
   */
  async onComplete(_result: AgentResult): Promise<void> {
    // Override in subclass for custom post-processing
  }

  /**
   * Called when run() encounters an error.
   * Also emits 'agent:error' event.
   * @param error The error that occurred
   */
  async onError(_error: Error): Promise<void> {
    // Override in subclass for custom error handling
  }

  // --- Helper methods ---

  /**
   * Extract workflow steps from the SDK result.
   * This is a placeholder that can be enhanced based on SDK response structure.
   */
  private extractSteps(result: unknown): WorkflowStep[] | undefined {
    // Attempt to extract steps from various possible result formats
    const r = result as Record<string, unknown>;

    // Check for plan with steps
    if (r.plan && typeof r.plan === 'object') {
      const plan = r.plan as Record<string, unknown>;
      if (Array.isArray(plan.steps)) {
        return plan.steps.map((step: Record<string, unknown>) => ({
          number: (step.number as number) || 0,
          description: (step.description as string) || '',
          status: (step.status as WorkflowStep['status']) || 'completed',
          result: step.result as WorkflowStep['result'],
        }));
      }
    }

    // Check for direct steps array
    if (Array.isArray(r.steps)) {
      return r.steps as WorkflowStep[];
    }

    return undefined;
  }
}

// Agent event types for TypeScript users
export interface AgentEvents {
  'agent:start': (input: AgentInput) => void;
  'agent:step': (step: WorkflowStep) => void;
  'agent:complete': (result: AgentResult) => void;
  'agent:error': (error: Error) => void;
}
