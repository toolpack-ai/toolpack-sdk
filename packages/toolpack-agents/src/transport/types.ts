import type { AgentInput, AgentResult } from '../agent/types.js';

/**
 * Transport interface for agent-to-agent communication.
 * Enables pluggable transport mechanisms (local, JSON-RPC, etc.)
 */
export interface AgentTransport {
  /**
   * Invoke a remote agent by name.
   * @param agentName The name of the target agent
   * @param input The input to send to the agent
   * @returns The agent's result
   */
  invoke(agentName: string, input: AgentInput): Promise<AgentResult>;
}

/**
 * Options for configuring the AgentRegistry transport.
 */
export interface AgentRegistryTransportOptions {
  /** Transport implementation for cross-process communication */
  transport?: AgentTransport;
}
