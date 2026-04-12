import type { AgentInput, AgentResult, IAgentRegistry } from '../agent/types.js';
import type { AgentTransport } from './types.js';
import { AgentError } from '../agent/errors.js';

/**
 * Local transport for same-process agent delegation.
 * Resolves agents via the AgentRegistry and calls invokeAgent() directly.
 */
export class LocalTransport implements AgentTransport {
  constructor(private registry: IAgentRegistry) {}

  async invoke(agentName: string, input: AgentInput): Promise<AgentResult> {
    const agent = this.registry.getAgent(agentName);
    
    if (!agent) {
      throw new AgentError(
        `Agent "${agentName}" not found in registry. ` +
        `Available agents: ${this.registry.getAllAgents().map(a => a.name).join(', ')}`
      );
    }

    return await agent.invokeAgent(input);
  }
}
