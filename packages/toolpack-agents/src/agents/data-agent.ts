import type { Toolpack } from 'toolpack-sdk';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';

export class DataAgent extends BaseAgent {
  name = 'data-agent';
  description = 'Data agent for database queries, CSV generation, data analysis, reporting, and aggregation';
  mode = 'agent';

  systemPrompt = [
    'You are a data agent specialized in database operations and data analysis.',
    'Use db.* tools for database queries, fs.* for file operations, and http.* for API requests.',
    'Generate clear, well-formatted reports and summaries.',
    'Always validate data integrity and handle errors gracefully.',
    'Provide insights and patterns when analyzing data.',
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
