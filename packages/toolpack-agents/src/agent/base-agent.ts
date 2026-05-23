import { EventEmitter } from 'events';
import type { RequestToolDefinition, ConversationStore, AssemblerOptions, ModeConfig } from 'toolpack-sdk';
import { Toolpack, InMemoryConversationStore } from 'toolpack-sdk';
import type { Interceptor } from '../interceptors/types.js';
import { composeChain, executeChain } from '../interceptors/chain.js';
import { createCaptureInterceptor, CAPTURE_INTERCEPTOR_MARKER } from '../interceptors/builtins/capture-history.js';
import { assemblePrompt } from '../history/assembler.js';
import type { AgentInput, AgentResult, AgentOutput, AgentRunOptions, WorkflowStep, IAgentRegistry, PendingAsk, ChannelInterface, BaseAgentOptions } from './types.js';
import { AgentError } from './errors.js';
import type { AgentMindConfig } from '../mind/types.js';
import type { AgentMind } from '../mind/agent-mind.js';
import type { AgentDelegationConfig } from './types.js';

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

  /**
   * Mode this agent runs in. Each agent owns a full ModeConfig including its
   * system prompt, allowed tools, workflow, and tool-search policy. The mode
   * is registered with the Toolpack on first run and activated for every
   * invocation.
   *
   * Use built-in modes (AGENT_MODE, CHAT_MODE, CODING_MODE) as a base, or
   * compose a custom ModeConfig.
   */
  abstract mode: ModeConfig | string;

  // --- Optional identity properties ---
  /** Provider override (e.g., 'anthropic', 'openai') - inherits from Toolpack if not set */
  provider?: string;

  /** Model override - inherits from provider default if not set */
  model?: string;

  // --- Optional behavior properties ---
  /** Workflow configuration merged on top of mode config */
  workflow?: Record<string, unknown>;

  /**
   * Persistent cognitive layer. When set, the agent gains goals, beliefs, and
   * reflections that survive across runs. Requires @toolpack-sdk/knowledge.
   * Set to undefined (default) to opt out — zero cost when not configured.
   */
  mind?: AgentMindConfig;

  /**
   * AI-driven agent delegation. When enabled, a `delegate_to_agent` tool is
   * injected into every run() call so the LLM can hand tasks to peer agents.
   * Only active when the agent is registered in an AgentRegistry with peers.
   * Set to undefined (default) to opt out — zero cost when not configured.
   */
  delegation?: AgentDelegationConfig;

  /**
   * Conversation history store. Auto-initialised to `InMemoryConversationStore` in the
   * constructor so subclass field initialisers (e.g. `interceptors = [createCaptureInterceptor({
   * store: this.conversationHistory })]`) can reference it safely. Replace with a
   * database-backed implementation for production persistence.
   */
  conversationHistory: ConversationStore;

  /**
   * Options forwarded to `assemblePrompt()` when `run()` builds LLM context from history.
   * Defaults to `assemblePrompt`'s own defaults (addressed-only mode on, 3 000-token budget).
   */
  assemblerOptions?: AssemblerOptions;

  /** Channels this agent listens on and sends responses to */
  channels: ChannelInterface[] = [];

  /** Interceptors applied to every inbound message before invokeAgent is called */
  interceptors: Interceptor[] = [];

  // --- Internal references ---
  /** Reference to the registry for sendTo() and delegation support */
  _registry?: IAgentRegistry;

  /**
   * Invocation-scoped context fields — set by `_bindChannel` immediately before
   * calling `invokeAgent` and read inside `run()`, `ask()`, and `delegate()`.
   *
   * KNOWN LIMITATION: these are instance-level fields, not async-local storage.
   * Two different conversations processed concurrently by the same agent can
   * clobber each other's values. The conversation lock serialises within a single
   * conversationId, but distinct conversationIds run concurrently.
   *
   * Fix: replace with `AsyncLocalStorage` in a future release. For now, agents
   * that call `this.run()` while processing multiple concurrent conversations
   * should pass `conversationId` explicitly to avoid relying on these fields.
   */
  _triggeringChannel?: string;
  _conversationId?: string;
  _isTriggerChannel?: boolean;

  protected toolpack!: Toolpack;

  private readonly _initConfig?: { apiKey: string; provider?: string; model?: string };
  private _ownedToolpack = false;
  private readonly _conversationLocks = new Map<string, Promise<void>>();
  private _mind?: AgentMind;
  private _mindInitPromise?: Promise<void>;

  constructor(options: BaseAgentOptions) {
    super();
    // Auto-init here (before child field initialisers run) so that subclass
    // field expressions like `interceptors = [createCaptureInterceptor({ store:
    // this.conversationHistory })]` see a live store, not undefined.
    this.conversationHistory = new InMemoryConversationStore();
    if ('toolpack' in options) {
      this.toolpack = options.toolpack;
    } else {
      this._initConfig = options;
    }
  }

  /**
   * Ensure the Toolpack instance is ready.
   * No-op if the toolpack was provided at construction time.
   * Creates and owns the instance from `apiKey` if it was not.
   */
  async _ensureToolpack(): Promise<void> {
    if (this.toolpack) return;
    if (!this._initConfig) {
      throw new Error(`[${this.name ?? 'agent'}] Cannot start: no apiKey or toolpack provided`);
    }
    this.toolpack = await Toolpack.init({
      provider: this._initConfig.provider ?? 'anthropic',
      apiKey: this._initConfig.apiKey,
      model: this._initConfig.model,
    });
    this._ownedToolpack = true;
  }

  /**
   * Lazily initialise the AgentMind instance the first time it is needed.
   * No-op when `this.mind` is not configured.
   * Uses a shared promise to prevent duplicate initialisation under concurrent run() calls.
   */
  async _ensureMind(): Promise<void> {
    if (this._mind !== undefined || !this.mind) return;
    if (!this._mindInitPromise) {
      this._mindInitPromise = (async () => {
        const { AgentMind } = await import('../mind/agent-mind.js');
        this._mind = await AgentMind.create(this.name, this.mind!);
      })().catch(err => {
        // Clear so the next call retries
        this._mindInitPromise = undefined;
        throw err;
      });
    }
    await this._mindInitPromise;
  }

  /**
   * Start the agent: initialise Toolpack (if needed), bind message handlers to all
   * configured channels, and begin listening.
   *
   * When using AgentRegistry, the registry calls this after setting `_registry`.
   * For standalone single-agent deployments, call this directly.
   */
  async start(): Promise<void> {
    await this._ensureToolpack();
    // Register and activate the agent's mode as the Toolpack default so the
    // startup log reflects the agent (e.g. "Kael") instead of the built-in
    // default ("Chat").
    if (this.mode) {
      if (typeof this.mode === 'string') {
        this.toolpack.setMode(this.mode);
      } else {
        this.toolpack.registerMode(this.mode);
        this.toolpack.setMode(this.mode.name);
      }
    }
    for (const channel of this.channels) {
      this._bindChannel(channel);
      channel.listen();
    }
  }

  /**
   * Stop all channels and release resources owned by this agent.
   */
  async stop(): Promise<void> {
    for (const channel of this.channels) {
      if ('stop' in channel && typeof (channel as { stop?: unknown }).stop === 'function') {
        await (channel as { stop: () => Promise<void> }).stop();
      }
    }
    if (this._ownedToolpack) {
      await this.toolpack.disconnect?.();
    }
  }

  /**
   * Main entry point for agent invocation.
   * Implement this to handle incoming messages and route to appropriate logic.
   */
  abstract invokeAgent(input: AgentInput<TIntent>): Promise<AgentResult>;

  /**
   * Execute the agent using the Toolpack SDK.
   *
   * @param message - The user message to process.
   * @param _options - Optional per-run workflow overrides.
   * @param context - Optional context overrides. Supply `conversationId` here when
   *   invoking from `invokeAgent()` to avoid the instance-level `_conversationId`
   *   race that occurs when the same agent handles multiple concurrent conversations.
   */
  protected async run(
    message: string,
    _options?: AgentRunOptions,
    context?: { conversationId?: string },
  ): Promise<AgentResult> {
    // Prefer the explicitly supplied conversationId; fall back to the
    // instance-level field (set by _bindChannel) for channel-driven invocations.
    const convId = context?.conversationId ?? this._conversationId;

    await this.onBeforeRun({ message, conversationId: convId } as AgentInput<TIntent>);
    this.emit('agent:start', { message });

    // Initialise mind and create a per-run context (draft buffer + tools + header).
    // Done before the try so the flush closure is always accessible in catch.
    await this._ensureMind();
    let mindFlush: ((isError: boolean) => Promise<void>) | undefined;
    let mindHeader = '';
    let mindTools: RequestToolDefinition[] = [];

    if (this._mind) {
      const runCtx = await this._mind.createRunContext();
      mindHeader = runCtx.mindHeader;
      mindTools = runCtx.tools;
      mindFlush = runCtx.flush;
    }

    try {
      // Register-then-activate. registerMode is idempotent for the same name,
      // so calling it on every run is cheap and avoids requiring callers to
      // pre-wire the mode in Toolpack.init({ customModes }).
      if (typeof this.mode === 'string') {
        this.toolpack.setMode(this.mode);
      } else {
        this.toolpack.registerMode(this.mode);
        this.toolpack.setMode(this.mode.name);
      }

      // System prompt is now owned by the mode and injected by the Toolpack
      // client (see injectModeSystemPrompt). BaseAgent no longer pushes its
      // own system message.
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

      // If the mind produced a header, prepend it as a system message.
      // injectModeSystemPrompt() will prepend the mode system prompt to the
      // first system message in the array, so the final order is:
      // [mode system prompt]\n\n[mind header]
      if (mindHeader) {
        messages.push({ role: 'system', content: mindHeader });
      }

      // Load history via assemblePrompt: proper multi-participant projection,
      // addressed-only mode, token budget, and rolling summary support.
      // Writes are handled exclusively by the capture-history interceptor —
      // run() is a read-only consumer of history.
      if (convId) {
        try {
          const assembled = await assemblePrompt(
            this.conversationHistory,
            convId,
            this.name,
            this.name,
            this._resolveAssemblerOptions(),
          );
          // When a channel's capture interceptor stores the inbound message before
          // calling next(), assemblePrompt includes it as the last item. Detect
          // that duplicate by checking whether the last assembled user message's
          // content matches the current message (the assembler prefixes it with
          // "DisplayName: ", so we check endsWith). Skip it here — run() pushes
          // the raw content below.
          const lastAssembled = assembled.messages[assembled.messages.length - 1];
          const trimmed = message.trim();
          const isDuplicate =
            trimmed !== '' &&
            lastAssembled?.role === 'user' &&
            typeof lastAssembled.content === 'string' &&
            (lastAssembled.content === trimmed || lastAssembled.content.endsWith(`: ${trimmed}`));
          const historyMessages = isDuplicate
            ? assembled.messages.slice(0, -1)
            : assembled.messages;
          messages.push(...historyMessages);
        } catch {
          // History fetch failure is non-fatal — continue without context.
        }
      }

      // Guard against empty content — Anthropic rejects user messages with empty content.
      if (message.trim()) {
        messages.push({ role: 'user', content: message });
      }

      // Expose a search tool when a conversation is active so the LLM can
      // retrieve specific past turns beyond the assembled context window.
      const requestTools: RequestToolDefinition[] = [...mindTools];
      if (convId) {
        const store = this.conversationHistory;
        requestTools.push({
          name: 'conversation_search',
          displayName: 'Conversation Search',
          description: 'Search past conversation history for specific information, questions, or topics mentioned earlier in this conversation.',
          category: 'search',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Keywords or phrases to search for in conversation history.' },
              limit: { type: 'number', description: 'Maximum number of results to return (default: 5).' },
            },
            required: ['query'],
          },
          execute: async (args: Record<string, unknown>) => {
            // Pillar 2 invariant: `convId` is closure-captured from run() intentionally.
            // Do NOT accept `args.conversationId` or any other channel/conversation
            // identifier from the LLM — doing so would let an adversarial prompt
            // reach turns from a different conversation. See §1.6 of
            // development/plan-docs/AGENT_CONFIDENTIALITY_AND_KNOWLEDGE.md.
            const results = await store.search(convId, String(args.query ?? ''), {
              limit: typeof args.limit === 'number' ? args.limit : 5,
            });
            return {
              results: results.map(m => ({
                role: m.participant.kind === 'agent' ? 'assistant' : 'user',
                content: m.content,
                timestamp: m.timestamp,
              })),
              count: results.length,
            };
          },
        });
      }

      // Inject agent delegation tool when enabled and peer agents exist.
      if (this.delegation?.enabled && this._registry) {
        const allowed = this.delegation.allowedAgents;
        const peers = this._registry.getAllAgents().filter(a =>
          a.name !== this.name && (allowed === undefined || allowed.includes(a.name)),
        );
        if (peers.length > 0) {
          const peerNames = peers.map(a => a.name);
          const peerDescriptions = peers.map(a => `- ${a.name}: ${a.description}`).join('\n');

          if (this.delegation.mode === 'forget') {
            // Fire-and-forget: sub-agent runs independently and handles its own
            // delivery via tools. Returns immediately so the LLM has no result
            // to relay and naturally outputs an empty string.
            requestTools.push({
              name: 'delegate_and_forget',
              displayName: 'Delegate and Forget',
              description:
                'Hand off the current task to a peer agent. The agent will handle ' +
                'its own delivery (e.g. posting to Slack or GitHub) — you do not need ' +
                'to relay its response. Call this ONCE, then output an empty string.\n\n' +
                `Available agents:\n${peerDescriptions}`,
              category: 'agent',
              parameters: {
                type: 'object',
                properties: {
                  agent: {
                    type: 'string',
                    enum: peerNames,
                    description: 'Name of the agent to delegate to.',
                  },
                  message: {
                    type: 'string',
                    description: 'The task or message to pass to the agent.',
                  },
                },
                required: ['agent', 'message'],
              },
              execute: async (args: Record<string, unknown>) => {
                const targetName = String(args.agent);
                const targetMessage = String(args.message ?? '');
                this._registry!.invoke(targetName, {
                  message: targetMessage,
                  conversationId: convId,
                  context: { delegatedBy: this.name },
                }).catch(err => {
                  console.error(`[${this.name}] delegate_and_forget to ${targetName} failed:`, err);
                });
                return { status: 'delegated', agent: targetName };
              },
            });
          } else {
            // Default await mode: calls the sub-agent, waits for its result,
            // and returns it to the LLM for relaying or further processing.
            requestTools.push({
              name: 'delegate_to_agent',
              displayName: 'Delegate to Agent',
              description:
                'Hand off the current task to a peer agent and return its result. ' +
                'Use when the task falls outside your own specialisation.\n\n' +
                `Available agents:\n${peerDescriptions}`,
              category: 'agent',
              parameters: {
                type: 'object',
                properties: {
                  agent: {
                    type: 'string',
                    enum: peerNames,
                    description: 'Name of the agent to delegate to.',
                  },
                  message: {
                    type: 'string',
                    description: 'The task or message to pass to the agent.',
                  },
                },
                required: ['agent', 'message'],
              },
              execute: async (args: Record<string, unknown>) => {
                const targetName = String(args.agent);
                const targetMessage = String(args.message ?? '');
                return this._registry!.invoke(targetName, {
                  message: targetMessage,
                  conversationId: convId,
                  context: { delegatedBy: this.name },
                });
              },
            });
          }
        }
      }

      const result = await this.toolpack.generate(
        {
          messages,
          model: this.model || '',
          requestTools: requestTools.length > 0 ? requestTools : undefined,
          // Forward the per-run maxToolRounds cap (if any) so AIClient respects it
          // as a hard ceiling, bypassing the query-classifier adjustment.
          maxToolRounds: _options?.maxToolRounds,
        },
        this.provider
      );

      const agentResult: AgentResult = {
        output: result.content || '',
        steps: this.extractSteps(result),
        metadata: result.usage ? { usage: result.usage } : undefined,
      };

      await this.onComplete(agentResult);

      // Commit the mind draft buffer on clean completion.
      // Propagates flush errors to the caller per spec.
      if (mindFlush) {
        await mindFlush(false);
      }

      this.emit('agent:complete', agentResult);

      return agentResult;
    } catch (error) {
      // Flush beliefs/reflections with error:true; drop goal writes.
      // We catch flush errors here so the original error is always propagated.
      if (mindFlush) {
        mindFlush(true).catch(flushErr => {
          console.error(`[${this.name ?? 'agent'}][AgentMind] Draft buffer flush on error failed:`, flushErr);
        });
      }

      await this.onError(error as Error);
      this.emit('agent:error', error);
      throw error;
    }
  }

  /**
   * Returns extra identity strings (platform user ids, bot ids) that should
   * be treated as this agent for the purposes of `addressed-only` mode in
   * `assemblePrompt`.
   *
   * The default implementation collects `botUserId` from every attached channel
   * that exposes it (e.g. `SlackChannel` after `auth.test` resolves). Override
   * this to add further aliases.
   */
  protected getAgentAliases(): string[] {
    const aliases: string[] = [];
    for (const channel of this.channels) {
      const botUserId = (channel as unknown as { botUserId?: string }).botUserId;
      if (botUserId) aliases.push(botUserId);
    }
    return aliases;
  }

  /**
   * Send a message to a named channel via the registry.
   */
  protected async sendTo(channelName: string, message: string): Promise<void> {
    if (!this._registry) {
      throw new Error('Agent not registered - _registry not set');
    }
    await this._registry.sendTo(channelName, { output: message });
  }

  /**
   * Ask the user a question and pause execution.
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

    if (this._isTriggerChannel) {
      throw new AgentError(
        'this.ask() called from a trigger channel (ScheduledChannel). ' +
          'Trigger channels have no human recipient — use a conversation channel (Slack, Telegram, Webhook) instead.'
      );
    }

    if (!this._triggeringChannel || this._triggeringChannel.trim() === '') {
      throw new AgentError(
        'Cannot use ask() - no triggering channel available. ' +
          'The channel must have a name registered with AgentRegistry.'
      );
    }

    const pendingAsk = this._registry.addPendingAsk({
      conversationId: this._conversationId,
      agentName: this.name,
      question,
      context: options?.context ?? {},
      maxRetries: options?.maxRetries ?? 2,
      expiresAt: options?.expiresIn ? new Date(Date.now() + options.expiresIn) : undefined,
      channelName: this._triggeringChannel,
    });

    await this.sendTo(this._triggeringChannel, question);

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
   */
  protected async resolvePendingAsk(id: string, answer: string): Promise<void> {
    if (!this._registry) {
      throw new AgentError('Agent not registered - cannot resolve ask');
    }
    await this._registry.resolvePendingAsk(id, answer);
  }

  /**
   * Evaluate if an answer sufficiently addresses a question.
   */
  protected async evaluateAnswer(
    question: string,
    answer: string,
    options?: {
      simpleValidation?: (answer: string) => boolean;
    }
  ): Promise<boolean> {
    if (options?.simpleValidation) {
      return options.simpleValidation(answer);
    }

    const result = await this.run(
      `Evaluate if this answer sufficiently addresses the question.\n\nQuestion: "${question}"\nAnswer: "${answer}"\n\nIs this answer sufficient? Reply with ONLY "yes" or "no".`,
      { workflow: { mode: 'single-shot' } }
    );

    return result.output.toLowerCase().trim().startsWith('yes');
  }

  /**
   * Handle a pending ask reply with automatic retry logic.
   */
  protected async handlePendingAsk(
    pending: PendingAsk,
    reply: string,
    onSufficient: (answer: string) => Promise<AgentResult> | AgentResult,
    onInsufficient?: () => Promise<AgentResult> | AgentResult
  ): Promise<AgentResult> {
    const sufficient = await this.evaluateAnswer(pending.question, reply, {
      simpleValidation: (a) => a.trim().length > 3,
    });

    if (sufficient) {
      await this.resolvePendingAsk(pending.id, reply);
      return onSufficient(reply);
    }

    if (pending.retries >= pending.maxRetries) {
      await this.resolvePendingAsk(pending.id, '__insufficient__');

      if (this._triggeringChannel) {
        await this.sendTo(
          this._triggeringChannel,
          'I was unable to get enough information to proceed. Skipping this step.'
        );
      }

      if (onInsufficient) {
        return onInsufficient();
      }

      return {
        output: 'Step skipped due to insufficient input.',
        metadata: { skipped: true, askId: pending.id },
      };
    }

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
   */
  /**
   * Delegate a task to another agent and wait for the result.
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

    return await this._registry.invoke(agentName, fullInput);
  }

  // --- Lifecycle hooks (override in subclasses) ---

  async onBeforeRun(_input: AgentInput<TIntent>): Promise<void> {}

  async onComplete(_result: AgentResult): Promise<void> {}

  async onError(_error: Error): Promise<void> {}

  // --- Private helpers ---

  /**
   * Build the `AssemblerOptions` used for this call to `assemblePrompt`.
   *
   * Merges any subclass-provided `assemblerOptions.agentAliases` with platform-bot
   * identities discovered on configured channels (e.g. `SlackChannel.botUserId`,
   * `TelegramChannel.botUserId`). Read lazily on each `run()` so that identities
   * populated asynchronously by each channel's startup self-check are picked up
   * without a race.
   */
  private _resolveAssemblerOptions(): AssemblerOptions | undefined {
    const channelAliases = this.channels
      .map(c => (c as { botUserId?: string }).botUserId)
      .filter((x): x is string => typeof x === 'string' && x.length > 0);

    const manualAliases = this.assemblerOptions?.agentAliases ?? [];

    if (channelAliases.length === 0 && manualAliases.length === 0) {
      return this.assemblerOptions;
    }

    const merged = Array.from(new Set([...manualAliases, ...channelAliases]));
    return { ...this.assemblerOptions, agentAliases: merged };
  }

  /**
   * Returns the effective interceptor list for a channel binding. Prepends
   * `createCaptureInterceptor` automatically so every inbound message and
   * agent reply is persisted without manual wiring. The `CAPTURE_INTERCEPTOR_MARKER`
   * check prevents double-registration if the developer already added one.
   */
  private _getEffectiveInterceptors(): Interceptor[] {
    const alreadyHasCapture = this.interceptors.some(
      i => (i as unknown as Record<symbol, unknown>)[CAPTURE_INTERCEPTOR_MARKER] === true
    );
    if (alreadyHasCapture) return this.interceptors;
    return [
      createCaptureInterceptor({ store: this.conversationHistory }),
      ...this.interceptors,
    ];
  }

  /**
   * Bind a message handler to a channel.
   * Extracted here so both standalone start() and AgentRegistry can reuse the same logic.
   */

  private _bindChannel(channel: ChannelInterface): void {
    channel.onMessage(async (input: AgentInput) => {
      if (!input.conversationId) {
        console.warn(`[${this.name}] Message received without conversationId — skipping`);
        return;
      }

      const releaseLock = await this._acquireConversationLock(input.conversationId);
      try {
        this._triggeringChannel = channel.name;
        this._isTriggerChannel = channel.isTriggerChannel;
        this._conversationId = input.conversationId;

        const chain = composeChain(
          this._getEffectiveInterceptors(),
          this, channel, this._registry ?? null
        );
        const chainResult = await executeChain(chain, input);
        if (chainResult === null) return;
        const result: AgentOutput = { output: chainResult.output, metadata: chainResult.metadata };

        await channel.send({
          output: result.output,
          metadata: {
            ...result.metadata,
            conversationId: input.conversationId,
            ...input.context,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`[${this.name}] Error in agent invocation: ${errorMessage}`);
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
          console.error(`[${this.name}] Failed to send error to channel: ${sendError}`);
        }
      } finally {
        releaseLock();
      }
    });
  }

  private async _acquireConversationLock(conversationId: string): Promise<() => void> {
    while (this._conversationLocks.has(conversationId)) {
      try {
        await this._conversationLocks.get(conversationId);
      } catch {
        // Previous lock holder failed — proceed
      }
    }

    let releaseLock!: () => void;
    const lock = new Promise<void>(resolve => { releaseLock = resolve; });
    this._conversationLocks.set(conversationId, lock);

    return () => {
      this._conversationLocks.delete(conversationId);
      releaseLock();
    };
  }

  private extractSteps(result: unknown): WorkflowStep[] | undefined {
    const r = result as Record<string, unknown>;

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
