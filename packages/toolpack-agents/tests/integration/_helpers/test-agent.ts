import { BaseAgent } from '../../../src/agent/base-agent.js';
import type { AgentInput, AgentResult, ChannelInterface } from '../../../src/agent/types.js';
import type { ScriptedLLM } from './scripted-llm.js';

export interface TestAgentConfig {
  name: string;
  scriptedLLM: ScriptedLLM;
  channels?: ChannelInterface[];
}

/**
 * Minimal BaseAgent subclass for integration tests.
 *
 * invokeAgent behaviour:
 * 1. Looks up the current script entry for this agent + message.
 * 2. If the entry lists delegations, runs each via delegateAndWait (parallel),
 *    then calls run() with an "aggregated results" message so the next script
 *    entry (the synthesis step) can produce the final reply.
 * 3. Otherwise calls run() with the original message.
 */
export class TestAgent extends BaseAgent {
  name: string;
  description: string;
  mode = 'chat';

  private scriptedLLM: ScriptedLLM;

  constructor(config: TestAgentConfig) {
    super({ toolpack: config.scriptedLLM.makeToolpack(config.name) });
    this.name = config.name;
    this.description = `Integration test agent: ${config.name}`;
    this.scriptedLLM = config.scriptedLLM;
    if (config.channels) this.channels = config.channels;
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const message = input.message ?? '';
    const entry = this.scriptedLLM.getEntry(this.name, message);

    if (entry?.delegations && entry.delegations.length > 0) {
      const results = await Promise.all(
        entry.delegations.map(d =>
          this.delegateAndWait(d.to, {
            message: d.message,
            conversationId: input.conversationId,
          }),
        ),
      );
      const aggregated = results.map(r => r.output).join('\n');
      return this.run(
        `aggregated results: ${aggregated}`,
        undefined,
        { conversationId: input.conversationId },
      );
    }

    return this.run(message, undefined, { conversationId: input.conversationId });
  }
}
