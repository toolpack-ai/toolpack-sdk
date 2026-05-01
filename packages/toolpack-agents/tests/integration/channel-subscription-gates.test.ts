/**
 * §4.2 — Channel subscription gates observation (Pillar 3)
 *
 * Verifies that an agent NOT invited to a channel never receives events
 * posted there — its conversation store for that channel remains empty —
 * and therefore cannot reference the confidential content.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../../src/agent/agent-registry.js';
import { ScriptedLLM } from './_helpers/scripted-llm.js';
import { TestAgent } from './_helpers/test-agent.js';
import { MockSlackWorkspace } from './_helpers/mock-slack-workspace.js';

const EXEC_CHANNEL = 'CEXEC';
const GENERAL_CHANNEL = 'CGENERAL';

let workspace: MockSlackWorkspace;
let registry: AgentRegistry;
let strategist: TestAgent;
let frontendAgent: TestAgent;

beforeEach(async () => {
  workspace = new MockSlackWorkspace();

  const llm = new ScriptedLLM({
    Strategist: [
      { match: /.*/, reply: 'Strategist received the message.' },
    ],
    Frontend: [
      { match: /anything from #exec/, reply: 'I have no information about #exec.' },
    ],
  });

  // Strategist → both #exec and #general
  const strategistExec = workspace.createChannel([EXEC_CHANNEL], 'strategist-exec');
  const strategistGeneral = workspace.createChannel([GENERAL_CHANNEL], 'strategist-general');

  // Frontend → #general ONLY (not #exec)
  const frontendGeneral = workspace.createChannel([GENERAL_CHANNEL], 'frontend-general');

  strategist = new TestAgent({
    name: 'Strategist',
    scriptedLLM: llm,
    channels: [strategistExec, strategistGeneral],
  });

  frontendAgent = new TestAgent({
    name: 'Frontend',
    scriptedLLM: llm,
    channels: [frontendGeneral],
  });

  registry = new AgentRegistry([strategist, frontendAgent]);
  await registry.start();
});

afterEach(async () => {
  await registry.stop();
});

describe('Pillar 3 — channel subscription gates observation', () => {
  it('Strategist receives #exec event and stores it', async () => {
    await workspace.postFromHuman(EXEC_CHANNEL, 'U_EXEC', 'Confidential note: target Q4.');

    const history = await strategist.conversationHistory.get(EXEC_CHANNEL);
    expect(history.length).toBeGreaterThan(0);
    expect(history.some(t => t.content.includes('Confidential note'))).toBe(true);
  });

  it('Frontend does NOT receive the #exec event — store is empty for that channel', async () => {
    await workspace.postFromHuman(EXEC_CHANNEL, 'U_EXEC', 'Confidential note: target Q4.');

    const frontendExecHistory = await frontendAgent.conversationHistory.get(EXEC_CHANNEL);
    expect(frontendExecHistory.length).toBe(0);
  });

  it('Frontend store search for #exec content returns nothing', async () => {
    await workspace.postFromHuman(EXEC_CHANNEL, 'U_EXEC', 'Confidential note: target Q4.');

    const results = await frontendAgent.conversationHistory.search(
      EXEC_CHANNEL,
      'Confidential target Q4',
      { limit: 10 },
    );
    expect(results.length).toBe(0);
  });

  it('Frontend CAN receive #general events independently', async () => {
    await workspace.postFromHuman(GENERAL_CHANNEL, 'U_HUMAN', 'Anything from #exec recently?');

    const frontendGeneralHistory = await frontendAgent.conversationHistory.get(GENERAL_CHANNEL);
    expect(frontendGeneralHistory.some(t => t.content.includes('#exec'))).toBe(true);
  });

  it('Strategist outbound post in #exec is captured; Frontend post array has no #exec entries', async () => {
    await workspace.postFromHuman(EXEC_CHANNEL, 'U_EXEC', 'Confidential note: target Q4.');

    const strategistPosts = workspace.postsFrom('strategist-exec');
    expect(strategistPosts.length).toBeGreaterThan(0);
    // Frontend never fired into #exec
    const frontendExecPosts = workspace.posts.filter(
      p => p.agentName.startsWith('frontend') && p.channelId === EXEC_CHANNEL,
    );
    expect(frontendExecPosts.length).toBe(0);
  });
});
