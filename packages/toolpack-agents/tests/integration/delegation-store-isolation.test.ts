/**
 * §4.5 — Per-agent store isolation under delegation
 *
 * Verifies that:
 * - When Lead delegates to Frontend with a conversationId, Frontend's store
 *   records the delegated exchange under that conversationId.
 * - After the delegation returns, a fresh message to Frontend from a human
 *   uses its own (independent) conversationId — the delegation scope does
 *   not bleed into the next unrelated conversation.
 * - Strategist's store never contains Frontend's or Backend's reasoning.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../../src/agent/agent-registry.js';
import { ScriptedLLM } from './_helpers/scripted-llm.js';
import { TestAgent } from './_helpers/test-agent.js';
import { MockSlackWorkspace } from './_helpers/mock-slack-workspace.js';

const TEAM_CHANNEL = 'CTEAM';
const FRESH_DM = 'DM_FRONTEND_HUMAN';

let workspace: MockSlackWorkspace;
let registry: AgentRegistry;
let lead: TestAgent;
let frontend: TestAgent;
let strategist: TestAgent;

beforeEach(async () => {
  workspace = new MockSlackWorkspace();

  const llm = new ScriptedLLM({
    Lead: [
      {
        match: /scope the dashboard/,
        reply: '',
        delegations: [
          { to: 'Frontend', message: 'Frontend spec: design the component list' },
        ],
      },
      { match: /aggregated/, reply: 'Synthesised plan based on frontend input.' },
    ],
    Frontend: [
      { match: /component list/, reply: 'Component plan: A, B, C.' },
      { match: /fresh human message/, reply: 'Handling fresh human request independently.' },
    ],
    Strategist: [
      { match: /.*/, reply: 'Strategist standing by.' },
    ],
  });

  const leadChannel = workspace.createChannel([TEAM_CHANNEL], 'lead-team');
  const frontendChannel = workspace.createChannel([TEAM_CHANNEL, FRESH_DM], 'frontend-channel');
  const strategistChannel = workspace.createChannel([TEAM_CHANNEL], 'strategist-team');

  lead = new TestAgent({ name: 'Lead', scriptedLLM: llm, channels: [leadChannel] });
  frontend = new TestAgent({ name: 'Frontend', scriptedLLM: llm, channels: [frontendChannel] });
  strategist = new TestAgent({ name: 'Strategist', scriptedLLM: llm, channels: [strategistChannel] });

  registry = new AgentRegistry([lead, frontend, strategist]);
  await registry.start();
});

afterEach(async () => {
  await registry.stop();
});

describe('Per-agent store isolation under delegation', () => {
  it('delegated exchange is recorded in the target agent store under the originating conversationId', async () => {
    await workspace.postFromHuman(TEAM_CHANNEL, 'U_HUMAN', 'scope the dashboard');

    // Frontend was delegated by Lead using TEAM_CHANNEL as conversationId
    const frontendHistory = await frontend.conversationHistory.get(TEAM_CHANNEL);
    expect(frontendHistory.length).toBeGreaterThan(0);

    // The inbound delegated message from Lead should be recorded
    const hasLeadMessage = frontendHistory.some(
      t => t.content.includes('component list') || t.participant.id === 'Lead',
    );
    expect(hasLeadMessage).toBe(true);
  });

  it("Strategist store does not contain Frontend's delegation reasoning", async () => {
    await workspace.postFromHuman(TEAM_CHANNEL, 'U_HUMAN', 'scope the dashboard');

    const strategistHistory = await strategist.conversationHistory.get(TEAM_CHANNEL);
    const hasFrontendContent = strategistHistory.some(
      t => t.content.includes('Component plan') || t.participant.id === 'Frontend',
    );
    expect(hasFrontendContent).toBe(false);
  });

  it('fresh DM to Frontend after delegation uses its own conversationId', async () => {
    // First trigger a delegation flow
    await workspace.postFromHuman(TEAM_CHANNEL, 'U_HUMAN', 'scope the dashboard');

    // Now send a completely unrelated DM directly to Frontend
    await workspace.postDM(FRESH_DM, 'U_HUMAN2', 'fresh human message for frontend');

    // The fresh DM must be stored under FRESH_DM, not TEAM_CHANNEL
    const freshHistory = await frontend.conversationHistory.get(FRESH_DM);
    expect(freshHistory.some(t => t.content.includes('fresh human message'))).toBe(true);

    // Confirm TEAM_CHANNEL content did not leak into FRESH_DM
    const freshSearch = await frontend.conversationHistory.search(FRESH_DM, 'component list', { limit: 5 });
    expect(freshSearch.some(r => r.conversationId !== FRESH_DM)).toBe(false);
  });
});
