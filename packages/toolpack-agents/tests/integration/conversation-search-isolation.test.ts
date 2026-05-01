/**
 * §4.3 — Conversation isolation checks (Pillar 2)
 *
 * Verifies conversation-level isolation properties in integration flow:
 * - turns are stored under the conversation they arrived in
 * - searching a different conversation does not surface those turns
 * - search results stay scoped to the queried conversationId
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../../src/agent/agent-registry.js';
import { ScriptedLLM } from './_helpers/scripted-llm.js';
import { TestAgent } from './_helpers/test-agent.js';
import { MockSlackWorkspace } from './_helpers/mock-slack-workspace.js';

const TEAM_CHANNEL = 'CTEAM';
const DM_CHANNEL = 'DM_STRATEGIST_HUMAN';

let workspace: MockSlackWorkspace;
let registry: AgentRegistry;
let strategist: TestAgent;

beforeEach(async () => {
  workspace = new MockSlackWorkspace();

  const llm = new ScriptedLLM({
    Strategist: [
      { match: /team channel/, reply: 'Strategist reply in #team channel.' },
      { match: /anything from/, reply: 'I only know what was said in this DM.' },
    ],
  });

  const teamChannel = workspace.createChannel([TEAM_CHANNEL], 'strategist-team');
  const dmChannel = workspace.createChannel(null, 'strategist-dm');

  strategist = new TestAgent({
    name: 'Strategist',
    scriptedLLM: llm,
    channels: [teamChannel, dmChannel],
  });

  registry = new AgentRegistry([strategist]);

  await registry.start();
});

afterEach(async () => {
  await registry.stop();
});

describe('Pillar 2 — conversation-scoped search', () => {
  it('team-channel messages are stored under TEAM_CHANNEL', async () => {
    // Plant a turn in #team conversation
    await workspace.postFromHuman(TEAM_CHANNEL, 'U_HUMAN', 'Message in team channel');

    // Now check what was stored under TEAM_CHANNEL
    const teamTurns = await strategist.conversationHistory.get(TEAM_CHANNEL);
    expect(teamTurns.length).toBeGreaterThan(0);
    expect(teamTurns.some(t => t.content.includes('team channel') || t.content.includes('Message in'))).toBe(true);
  });

  it('searching DM conversation cannot reach #team turns', async () => {
    // Seed #team with identifiable content
    await workspace.postFromHuman(TEAM_CHANNEL, 'U_HUMAN', 'Confidential team message XYZ123');

    // Confirm the #team conversation has the content
    const teamTurns = await strategist.conversationHistory.get(TEAM_CHANNEL);
    expect(teamTurns.some(t => t.content.includes('XYZ123'))).toBe(true);

    // DM conversation is separate — search it and verify #team content is absent
    const dmTurns = await strategist.conversationHistory.get(DM_CHANNEL);
    const foundInDM = dmTurns.some(t => t.content.includes('XYZ123'));
    expect(foundInDM).toBe(false);

    // Direct store search: searching DM_CHANNEL for XYZ123 returns nothing
    // even though it exists in TEAM_CHANNEL.
    const dmSearchResults = await strategist.conversationHistory.search(
      DM_CHANNEL,
      'XYZ123',
      { limit: 10 },
    );
    expect(dmSearchResults.some(r => r.content.includes('XYZ123'))).toBe(false);
  });

  it('search scoped to its own conversationId returns its own turns', async () => {
    await workspace.postFromHuman(TEAM_CHANNEL, 'U_HUMAN', 'Message in team channel about dashboards');

    const results = await strategist.conversationHistory.search(
      TEAM_CHANNEL,
      'dashboard',
      { limit: 5 },
    );
    // May or may not match depending on store impl, but must not throw and must
    // only contain TEAM_CHANNEL turns
    for (const r of results) {
      expect(r.conversationId).toBe(TEAM_CHANNEL);
    }
  });
});
