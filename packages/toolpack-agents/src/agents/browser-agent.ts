import { BaseAgentOptions } from './../agent/types.js';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';
import { CHAT_MODE, type ModeConfig } from 'toolpack-sdk';

/**
 * Built-in browser agent for web interaction tasks.
 * Handles web browsing, form interaction, page extraction, and link following.
 *
 * @example
 * ```ts
 * const browserAgent = new BrowserAgent(toolpack);
 * const result = await browserAgent.invokeAgent({
 *   message: 'Extract all product prices from example.com/products'
 * });
 * ```
 */
const BROWSER_AGENT_MODE: ModeConfig = {
  ...CHAT_MODE,
  name: 'browser-agent-mode',
  systemPrompt: [
    'You are a browser agent specialized in web interaction and content extraction.',
    'Use web.fetch to retrieve pages, web.screenshot for visual content, and web.extract_links for navigation.',
    'Follow links intelligently to gather comprehensive information.',
    'Extract structured data from web pages when possible.',
    'Be mindful of rate limits and respectful of website resources.',
  ].join(' '),
};

export class BrowserAgent extends BaseAgent {
  name = 'browser-agent';
  description = 'Browser agent for web browsing, form interaction, page extraction, and link following';
  mode = BROWSER_AGENT_MODE;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const result = await this.run(input.message || '', undefined, { conversationId: input.conversationId });
    await this.onComplete(result);
    return result;
  }
}
