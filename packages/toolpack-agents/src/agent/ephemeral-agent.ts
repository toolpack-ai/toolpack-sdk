import type { ModeConfig } from 'toolpack-sdk';
import { BaseAgent } from './base-agent.js';
import type { AgentInput, AgentResult, BaseAgentOptions } from './types.js';

/**
 * Lightweight concrete agent for one-off tasks.
 *
 * Typically instantiated internally by the `spawn_agent` tool. Can also be
 * constructed directly for testing or advanced orchestration. The mode (and
 * its system prompt) is supplied at construction time by the caller.
 *
 * No channels, no interceptors, no registry entry.
 */
export class EphemeralAgent extends BaseAgent {
  name: string;
  description: string;
  mode: ModeConfig | string;

  constructor(
    name: string,
    description: string,
    mode: ModeConfig | string,
    options: BaseAgentOptions,
  ) {
    super(options);
    this.name = name;
    this.description = description;
    this.mode = mode;
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    return this.run(input.message ?? '', undefined, {
      conversationId: input.conversationId,
      spawnDepth: (input.context?.spawnDepth as number | undefined) ?? 0,
    }, input.attachments);
  }
}
