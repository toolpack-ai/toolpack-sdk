import { BaseAgentOptions } from './../agent/types.js';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';
import { AGENT_MODE, type ModeConfig } from 'toolpack-sdk';

/**
 * Built-in data agent for database and data analysis tasks.
 * Handles database queries, CSV generation, data analysis, reporting, and aggregation.
 *
 * @example
 * ```ts
 * const dataAgent = new DataAgent(toolpack);
 * const result = await dataAgent.invokeAgent({
 *   message: 'Generate a monthly sales report from the orders table'
 * });
 * ```
 */
const DATA_AGENT_MODE: ModeConfig = {
  ...AGENT_MODE,
  name: 'data-agent-mode',
  systemPrompt: [
    'You are a data agent specialized in database operations and data analysis.',
    'Use db.* tools for database queries, fs.* for file operations, and http.* for API requests.',
    'Generate clear, well-formatted reports and summaries.',
    'Always validate data integrity and handle errors gracefully.',
    'Provide insights and patterns when analyzing data.',
  ].join(' '),
};

export class DataAgent extends BaseAgent {
  name = 'data-agent';
  description = 'Data agent for database queries, CSV generation, data analysis, reporting, and aggregation';
  mode = DATA_AGENT_MODE;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const result = await this.run(input.message || '', undefined, { conversationId: input.conversationId });
    await this.onComplete(result);
    return result;
  }
}
