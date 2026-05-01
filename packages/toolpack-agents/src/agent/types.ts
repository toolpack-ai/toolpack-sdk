import type { Toolpack, Participant, ModeConfig } from 'toolpack-sdk';
import type { EventEmitter } from 'events';
import type { Interceptor } from '../interceptors/types.js';

export type { Participant };

/**
 * Options for constructing a BaseAgent.
 *
 * - `{ apiKey, provider?, model? }` — agent creates and owns its own Toolpack instance.
 *   The instance is initialised lazily in `start()`.
 * - `{ toolpack }` — agent uses a shared Toolpack instance (e.g. passed from AgentRegistry
 *   for multi-agent setups where API client and config are shared).
 */
export type BaseAgentOptions =
  | { apiKey: string; provider?: string; model?: string }
  | { toolpack: Toolpack };


/**
 * Input structure for agent invocation.
 * Channels normalize external events into this format.
 */
export interface AgentInput<TIntent extends string = string> {
  /** Typed intent for routing decisions - compile-time safe when using generics */
  intent?: TIntent;

  /** Natural language message from the user */
  message?: string;

  /** Structured payload from the channel */
  data?: unknown;

  /** Additional context for the agent */
  context?: Record<string, unknown>;

  /** Channel-agnostic thread/session identifier for conversation continuity */
  conversationId?: string;

  /**
   * The participant who produced this message, as populated by the channel
   * during `normalize()` or resolved later via `channel.resolveParticipant`.
   * Interceptors such as `participant-resolver` read and/or enrich this.
   */
  participant?: Participant;
}

/**
 * Represents a step in a workflow execution.
 * This is a simplified interface that captures essential step information.
 */
export interface WorkflowStep {
  /** Step number (1-indexed) */
  number: number;

  /** Human-readable description of the step */
  description: string;

  /** Step execution status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

  /** Result after completion (if available) */
  result?: {
    success: boolean;
    output?: string;
    error?: string;
    toolsUsed?: string[];
    duration?: number;
  };
}

/**
 * Result structure returned by agents.
 */
export interface AgentResult {
  /** The agent's response/output */
  output: string;

  /** Workflow steps taken during execution (populated by run()) */
  steps?: WorkflowStep[];

  /** Optional metadata for routing decisions or post-processing */
  metadata?: Record<string, unknown>;
}

/**
 * Output structure sent to channels.
 */
export interface AgentOutput {
  output: string;
  metadata?: Record<string, unknown>;
}

/**
 * Options for a single agent run.
 */
export interface AgentRunOptions {
  /** One-off workflow override for this specific run */
  workflow?: Record<string, unknown>;
}

/**
 * Agent instance interface - shape of a BaseAgent instance.
 * This represents the public API surface of any agent.
 */
export interface AgentInstance<TIntent extends string = string> extends EventEmitter {
  /** Unique name of the agent */
  name: string;

  /** Human-readable description of the agent's purpose */
  description: string;

  /** LLM mode used by this agent (full ModeConfig or a registered mode name) */
  mode: ModeConfig | string;

  /** Channels this agent listens on and sends responses to */
  channels: ChannelInterface[];

  /** Interceptors applied to every inbound message before invokeAgent is called */
  interceptors: Interceptor[];

  /**
   * Main entry point for agent execution.
   * @param input The input containing message, intent, context, etc.
   * @returns The agent's result including output and metadata
   */
  invokeAgent(input: AgentInput<TIntent>): Promise<AgentResult>;

  /**
   * Start the agent: initialise Toolpack (if not provided), bind message handlers
   * to all configured channels, and begin listening.
   */
  start(): Promise<void>;

  /** Stop all channels and release owned resources. */
  stop(): Promise<void>;

  /**
   * Ensure the internal Toolpack instance is ready.
   * Called by AgentRegistry before start() so the toolpack is available
   * when _registry is set.
   */
  _ensureToolpack(): Promise<void>;

  /** Internal reference to the agent registry (set before start() by AgentRegistry) */
  _registry?: IAgentRegistry;

  /** Name of the channel that triggered this agent */
  _triggeringChannel?: string;

  /** Conversation ID for maintaining context across interactions */
  _conversationId?: string;

  /** Whether the triggering channel is a trigger channel (no human recipient) */
  _isTriggerChannel?: boolean;
}

/**
 * Channel interface for connecting agents to external systems.
 * Channels normalize incoming messages to AgentInput and send AgentOutput back.
 */
export interface ChannelInterface {
  /** Optional channel name for identification */
  name?: string;

  /**
   * Whether this is a trigger channel (no human recipient).
   * Trigger channels cannot use ask() - they must be fire-and-forget.
   */
  isTriggerChannel: boolean;

  /**
   * Start listening for incoming messages.
   * Called by AgentRegistry when the system starts.
   */
  listen(): void;

  /**
   * Send output back to the external system.
   * @param output The output to send
   */
  send(output: AgentOutput): Promise<void>;

  /**
   * Normalize raw incoming data to AgentInput format.
   * @param incoming Raw data from the external system
   * @returns Normalized AgentInput
   */
  normalize(incoming: unknown): AgentInput;

  /**
   * Register a handler for incoming messages.
   * @param handler Function to process incoming AgentInput
   */
  onMessage(handler: (input: AgentInput) => Promise<void>): void;

  /**
   * Optional hook to resolve richer `Participant` details (e.g. display name)
   * for a normalized input.
   *
   * Design:
   * - **Lazy.** Called at render/interceptor time, not during `normalize()`,
   *   so capture stays cheap.
   * - **Cacheable.** Implementations should cache per-process and invalidate
   *   on explicit platform signals (e.g. Slack `user_change`).
   * - **Fallback-safe.** If resolution fails, return `undefined` so the
   *   pipeline can fall back to the id. Must never throw on miss.
   *
   * The returned participant is merged into `input.participant` by the
   * `participant-resolver` interceptor. If the channel cannot resolve
   * anything, it should return `undefined`.
   */
  resolveParticipant?(input: AgentInput): Promise<Participant | undefined> | Participant | undefined;
}

/**
 * Alias for ChannelInterface to match spec naming convention.
 * @deprecated Use ChannelInterface for new code
 */
export type BaseChannel = ChannelInterface;

/**
 * Represents a pending human-in-the-loop question.
 * Stored in-memory in PendingAsksStore (inside AgentRegistry).
 */
export interface PendingAsk {
  /** Unique identifier for this ask */
  id: string;

  /** Ties ask to the conversation thread */
  conversationId: string;

  /** Agent that created this ask */
  agentName: string;

  /** The question sent to the human */
  question: string;

  /** Developer-stored state needed to continue */
  context: Record<string, unknown>;

  /** Current status of the ask */
  status: 'pending' | 'answered' | 'expired';

  /** The human's answer (if status is 'answered') */
  answer?: string;

  /** Number of times this ask has been retried */
  retries: number;

  /** Maximum retry attempts before giving up */
  maxRetries: number;

  /** When the ask was created */
  askedAt: Date;

  /** Optional expiration time */
  expiresAt?: Date;

  /** Channel name to send follow-up questions to (required for auto-send) */
  channelName: string;
}

/**
 * Interface for the AgentRegistry.
 * Manages agent instances, channels, pending asks, and agent-to-agent communication.
 */
export interface IAgentRegistry {
  /**
   * Start all registered agents and their channels.
   * Each agent initialises its own Toolpack instance (or uses the shared one it was
   * constructed with) before channels begin listening.
   */
  start(): Promise<void>;

  /**
   * Send output to a specific channel by name.
   * @param channelName The name of the channel to send to
   * @param output The output to send
   */
  sendTo(channelName: string, output: AgentOutput): Promise<void>;

  /**
   * Get an agent instance by name.
   * @param name The agent name
   * @returns The agent instance or undefined if not found
   */
  getAgent(name: string): AgentInstance | undefined;

  /**
   * Get all registered agent instances.
   * @returns Array of all agent instances
   */
  getAllAgents(): AgentInstance[];

  /**
   * Get a registered channel by name.
   * @param name The channel name
   * @returns The channel interface or undefined if not found
   */
  getChannel(name: string): ChannelInterface | undefined;

  /**
   * Invoke an agent by name through the transport layer.
   * Used internally by delegate() and delegateAndWait() on BaseAgent.
   * @param agentName The target agent's name
   * @param input The invocation input
   * @returns The agent's result
   */
  invoke(agentName: string, input: AgentInput): Promise<AgentResult>;

  /**
   * Get a pending ask for a conversation.
   * @param conversationId The conversation ID
   * @returns The pending ask or undefined
   */
  getPendingAsk(conversationId: string): PendingAsk | undefined;

  /**
   * Add a new pending ask to the store.
   * @param ask The ask data (without auto-generated fields)
   * @returns The created PendingAsk with generated fields
   */
  addPendingAsk(ask: Omit<PendingAsk, 'id' | 'askedAt' | 'retries' | 'status'>): PendingAsk;

  /**
   * Resolve a pending ask with an answer.
   * @param id The ask ID
   * @param answer The human's answer
   */
  resolvePendingAsk(id: string, answer: string): Promise<void>;

  /**
   * Check if a conversation has pending asks.
   * @param conversationId The conversation ID
   * @returns True if there are pending asks
   */
  hasPendingAsks(conversationId: string): boolean;

  /**
   * Increment the retry count for a pending ask.
   * @param id The ask ID
   * @returns The new retry count or undefined if ask not found
   */
  incrementRetries(id: string): number | undefined;

  /**
   * Clean up expired pending asks.
   * @returns Number of asks cleaned up
   */
  cleanupExpiredAsks(): number;
}
