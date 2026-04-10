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

// Agent instance interface - shape of a BaseAgent instance
export interface AgentInstance<TIntent extends string = string> extends EventEmitter {
  name: string;
  description: string;
  mode: string;
  invokeAgent(input: AgentInput<TIntent>): Promise<AgentResult>;
  _registry?: IAgentRegistry;
  _triggeringChannel?: string;
}

// Channel interface
export interface ChannelInterface {
  name?: string;
  listen(): void;
  send(output: AgentOutput): Promise<void>;
  normalize(incoming: unknown): AgentInput;
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

// AgentRegistry interface
export interface IAgentRegistry {
  start(toolpack: Toolpack): void;
  sendTo(channelName: string, output: AgentOutput): Promise<void>;
}
