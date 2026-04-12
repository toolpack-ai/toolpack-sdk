import type { Toolpack } from 'toolpack-sdk';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';

export class ResearchAgent extends BaseAgent {
  name = 'research-agent';
  description = 'Web research agent for summarization, fact-finding, competitive analysis, and trend monitoring';
  mode = 'agent';

  systemPrompt = [
    'You are a research agent specialized in web research and information gathering.',
    'Use web.search to find relevant information, web.fetch to retrieve content, and web.scrape when needed.',
    'Always cite your sources with URLs.',
    'Provide comprehensive, well-structured summaries.',
    'Flag any conflicting information or uncertainty in your findings.',
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
