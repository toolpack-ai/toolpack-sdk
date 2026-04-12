import type { Toolpack } from 'toolpack-sdk';
import type { EventEmitter } from 'events';

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

  /** LLM mode used by this agent (chat, code, planning, etc.) */
  mode: string;

  /**
   * Main entry point for agent execution.
   * @param input The input containing message, intent, context, etc.
   * @returns The agent's result including output and metadata
   */
  invokeAgent(input: AgentInput<TIntent>): Promise<AgentResult>;

  /** Internal reference to the agent registry (set by AgentRegistry) */
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
}

/**
 * Alias for ChannelInterface to match spec naming convention.
 * @deprecated Use ChannelInterface for new code
 */
export type BaseChannel = ChannelInterface;

/**
 * Registration entry for an agent with its associated channels.
 */
export interface AgentRegistration<TIntent extends string = string> {
  /** Agent class constructor */
  agent: new (toolpack: Toolpack) => AgentInstance<TIntent>;

  /** Channels that can trigger this agent */
  channels: ChannelInterface[];
}

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
   * Start the registry and initialize all agents and channels.
   * @param toolpack The Toolpack instance to pass to agents
   */
  start(toolpack: Toolpack): void;

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
