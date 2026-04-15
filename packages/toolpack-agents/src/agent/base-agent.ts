import { EventEmitter } from 'events';
import type { Toolpack } from 'toolpack-sdk';
import type { Knowledge } from '@toolpack-sdk/knowledge';
import { AgentInput, AgentResult, AgentRunOptions, WorkflowStep, IAgentRegistry, PendingAsk } from './types.js';
import { AgentError } from './errors.js';
import { ConversationHistory } from '../conversation-history/index.js';

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

  /** Conversation history storage - separate from domain knowledge */
  conversationHistory?: ConversationHistory;

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

      // ── Build dynamic system prompt ──────────────────────────────────────
      // Start with the agent's own system prompt (if any), then append
      // guidance for each meta-tool that is configured.  These instructions
      // are always sent regardless of toolsConfig so the AI knows when to
      // reach for knowledge / conversation history.
      let systemPromptContent = this.systemPrompt || '';

      if (this.knowledge) {
        systemPromptContent +=
          '\n\n**Knowledge Base:** You have access to a domain-specific knowledge base. ' +
          'When you need factual information that may be stored there, call the ' +
          '`knowledge_search` tool with a concise query before answering.';
      }

      if (this.conversationHistory?.isSearchEnabled && this._conversationId) {
        systemPromptContent +=
          `\n\n**Conversation History Search:** Only the most recent ` +
          `${this.conversationHistory.getHistoryLimit()} messages are shown above. ` +
          'When you need to recall details from earlier in the conversation, call the ' +
          '`conversation_search` tool with a relevant query.';
      }

      // ── Build messages array ─────────────────────────────────────────────
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

      if (systemPromptContent) {
        messages.push({ role: 'system', content: systemPromptContent });
      }

      // Fetch recent conversation history (respects configured limit)
      if (this.conversationHistory && this._conversationId) {
        try {
          const history = await this.conversationHistory.getHistory(this._conversationId);
          messages.push(...history);
        } catch {
          // If history fetch fails, continue without it
        }
      }

      // Current user message (always last before the AI call)
      messages.push({ role: 'user', content: message });

      // Store user message in conversation history BEFORE AI call
      if (this.conversationHistory && this._conversationId) {
        try {
          await this.conversationHistory.addUserMessage(
            this._conversationId,
            message,
            this.name
          );
        } catch {
          // If history storage fails, continue without crashing
        }
      }

      // ── Build meta-tools ─────────────────────────────────────────────────
      // Meta-tools (knowledge_search, conversation_search) are agent
      // infrastructure — they bypass toolsConfig and are ALWAYS injected
      // when the corresponding feature is configured on this agent.
      // Regular developer tools continue to be managed by toolsConfig/ToolRegistry.
      const metaTools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [];
      const metaToolExecutors = new Map<string, (args: Record<string, any>) => Promise<unknown>>();

      const knowledgeTool = this.knowledge?.toTool();
      if (knowledgeTool) {
        metaTools.push({
          type: 'function' as const,
          function: {
            name: knowledgeTool.name,
            description: knowledgeTool.description,
            parameters: knowledgeTool.parameters as Record<string, unknown>,
          },
        });
        metaToolExecutors.set(knowledgeTool.name, knowledgeTool.execute as (args: Record<string, any>) => Promise<unknown>);
      }

      if (this.conversationHistory?.isSearchEnabled && this._conversationId) {
        const conversationSearchTool = this.conversationHistory.toTool(this._conversationId);
        metaTools.push({
          type: 'function' as const,
          function: {
            name: conversationSearchTool.name,
            description: conversationSearchTool.description,
            parameters: conversationSearchTool.parameters as Record<string, unknown>,
          },
        });
        metaToolExecutors.set(conversationSearchTool.name, conversationSearchTool.execute as (args: Record<string, any>) => Promise<unknown>);
      }

      // ── First AI call ────────────────────────────────────────────────────
      // Pass meta-tools explicitly so they are available even when
      // tools.enabled = false in toolsConfig.
      let result = await this.toolpack.generate(
        {
          messages,
          model: this.model || '',
          tools: metaTools.length > 0 ? metaTools : undefined,
        },
        this.provider
      );

      // ── Meta-tool execution loop ─────────────────────────────────────────
      // AIClient auto-executes tools from its ToolRegistry, but meta-tools
      // live outside that registry so we handle their calls here.
      if (result.tool_calls && result.tool_calls.length > 0) {
        for (const toolCall of result.tool_calls) {
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [{ id: toolCall.id, type: 'function', function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) } }],
          } as any);

          const executor = metaToolExecutors.get(toolCall.name);
          let toolResult: unknown;
          if (executor) {
            try {
              toolResult = await executor(toolCall.arguments);
            } catch (err) {
              toolResult = { error: (err as Error).message };
            }
          } else {
            toolResult = { error: `Meta-tool '${toolCall.name}' not found` };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          } as any);
        }

        // Second AI call — get final answer now that tool results are injected
        result = await this.toolpack.generate(
          { messages, model: this.model || '' },
          this.provider
        );
      }

      // ── Persist assistant response ───────────────────────────────────────
      if (this.conversationHistory && this._conversationId) {
        try {
          if (result.content) {
            await this.conversationHistory.addAssistantMessage(
              this._conversationId,
              result.content,
              this.name
            );
          }
        } catch {
          // If history storage fails, continue without crashing
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
