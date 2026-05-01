import { randomUUID } from 'crypto';
import type { AgentInput, AgentResult, IAgentRegistry } from '../agent/types.js';
import type { AgentTransport } from './types.js';
import type { ConversationStore, StoredMessage } from '../history/types.js';
import { AgentError } from '../agent/errors.js';

/**
 * Local transport for same-process agent delegation.
 * Resolves agents via the AgentRegistry and calls invokeAgent() directly.
 *
 * Also captures delegated exchanges into the target agent's `conversationHistory`
 * so that the peer-agent's store reflects the full dialogue, including turns
 * initiated by other agents rather than human users.
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

    // Access the target agent's conversation store (present on BaseAgent instances).
    const store = (agent as unknown as { conversationHistory?: ConversationStore }).conversationHistory;
    const conversationId = input.conversationId;
    const delegatingAgentName = input.context?.delegatedBy as string | undefined;

    // Capture the inbound delegated message as an 'agent' turn so the target's
    // history reflects who sent it.
    if (store && conversationId && delegatingAgentName) {
      const inbound: StoredMessage = {
        id: (input.context?.messageId as string | undefined) ?? randomUUID(),
        conversationId,
        participant: { kind: 'agent', id: delegatingAgentName, displayName: delegatingAgentName },
        content: input.message ?? '',
        timestamp: new Date().toISOString(),
        scope: 'channel',
        metadata: {},
      };
      try { await store.append(inbound); } catch { /* non-fatal — history errors must not crash the pipeline */ }
    }

    const result = await agent.invokeAgent(input);

    // Capture the target agent's reply so it appears in the store alongside the inbound.
    if (store && conversationId) {
      const reply: StoredMessage = {
        id: randomUUID(),
        conversationId,
        participant: { kind: 'agent', id: agentName, displayName: agentName },
        content: result.output,
        timestamp: new Date().toISOString(),
        scope: 'channel',
        metadata: {},
      };
      try { await store.append(reply); } catch { /* non-fatal */ }
    }

    return result;
  }
}
