import { BaseAgentOptions } from './../agent/types.js';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';
import { AGENT_MODE, type ModeConfig } from 'toolpack-sdk';

/**
 * Built-in research agent for web research and information gathering.
 * Specialized in summarization, fact-finding, competitive analysis, and trend monitoring.
 *
 * @example
 * ```ts
 * const researchAgent = new ResearchAgent(toolpack);
 * const result = await researchAgent.invokeAgent({
 *   message: 'Research latest AI regulations in the EU'
 * });
 * ```
 */
const RESEARCH_AGENT_MODE: ModeConfig = {
  ...AGENT_MODE,
  name: 'research-agent-mode',
  systemPrompt: [
    'You are a research agent specialized in web research and information gathering.',
    'Use web.search to find relevant information, web.fetch to retrieve content, and web.scrape when needed.',
    'Always cite your sources with URLs.',
    'Provide comprehensive, well-structured summaries.',
    'Flag any conflicting information or uncertainty in your findings.',
  ].join(' '),
};

export class ResearchAgent extends BaseAgent {
  name = 'research-agent';
  description = 'Web research agent for summarization, fact-finding, competitive analysis, and trend monitoring';
  mode = RESEARCH_AGENT_MODE;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const result = await this.run(input.message || '', undefined, { conversationId: input.conversationId });
    await this.onComplete(result);
    return result;
  }
}
