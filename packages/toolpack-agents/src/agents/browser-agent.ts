import type { Toolpack } from 'toolpack-sdk';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';

export class BrowserAgent extends BaseAgent {
  name = 'browser-agent';
  description = 'Browser agent for web browsing, form interaction, page extraction, and link following';
  mode = 'chat';

  systemPrompt = [
    'You are a browser agent specialized in web interaction and content extraction.',
    'Use web.fetch to retrieve pages, web.screenshot for visual content, and web.extract_links for navigation.',
    'Follow links intelligently to gather comprehensive information.',
    'Extract structured data from web pages when possible.',
    'Be mindful of rate limits and respectful of website resources.',
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
