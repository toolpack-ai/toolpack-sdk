import { BaseAgentOptions } from './../agent/types.js';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';
import { CODING_MODE, type ModeConfig } from 'toolpack-sdk';

/**
 * Built-in coding agent for software development tasks.
 * Handles code generation, refactoring, debugging, test writing, and code review.
 *
 * @example
 * ```ts
 * const codingAgent = new CodingAgent(toolpack);
 * const result = await codingAgent.invokeAgent({
 *   message: 'Refactor this function to use async/await'
 * });
 * ```
 */
const CODING_AGENT_MODE: ModeConfig = {
  ...CODING_MODE,
  name: 'coding-agent-mode',
  systemPrompt: [
    'You are a coding agent specialized in software development tasks.',
    'Use coding.* tools for code analysis, fs.* for file operations, and git.* for version control.',
    'Write clean, idiomatic code following best practices.',
    'Always verify your changes and check for potential issues.',
    'Provide clear explanations of your code changes.',
  ].join(' '),
};

export class CodingAgent extends BaseAgent {
  name = 'coding-agent';
  description = 'Coding agent for code generation, refactoring, debugging, test writing, and code review';
  mode = CODING_AGENT_MODE;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const result = await this.run(input.message || '', undefined, { conversationId: input.conversationId });
    await this.onComplete(result);
    return result;
  }
}
