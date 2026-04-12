import type { Toolpack } from 'toolpack-sdk';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';

export class CodingAgent extends BaseAgent {
  name = 'coding-agent';
  description = 'Coding agent for code generation, refactoring, debugging, test writing, and code review';
  mode = 'coding';

  systemPrompt = [
    'You are a coding agent specialized in software development tasks.',
    'Use coding.* tools for code analysis, fs.* for file operations, and git.* for version control.',
    'Write clean, idiomatic code following best practices.',
    'Always verify your changes and check for potential issues.',
    'Provide clear explanations of your code changes.',
  ].join(' ');

  constructor(toolpack: Toolpack) {
    super(toolpack);
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const result = await this.run(input.message || '');
    await this.onComplete(result);
    return result;
  }
}
