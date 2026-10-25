import { describe, it, expect, vi } from 'vitest';
import { AgentMind } from './agent-mind.js';
import type { MindEntryType } from './types.js';

// `kinds`: an agent that remembers only some kinds of entry (for example facts only) never reads, shows or writes the others.

const DUMMY_VECTOR = [1, 0, 0];

/** A provider that holds nothing but records what is asked of it. */
function makeMind(kinds?: MindEntryType[]) {
  const asked: { filterType?: string }[] = [];
  const provider = {
    validateDimensions: vi.fn(),
    add: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(async (_v: number[], options?: { filter?: Record<string, unknown> }) => { asked.push({ filterType: options?.filter?._type as string | undefined }); return []; }),
    keywordQuery: vi.fn(async (_q: string, options?: { filter?: Record<string, unknown> }) => { asked.push({ filterType: options?.filter?._type as string | undefined }); return []; }),
    delete: vi.fn(),
    clear: vi.fn(),
    getAllChunks: vi.fn(async () => { asked.push({ filterType: 'all' }); return []; }),
  };
  const embedder = { dimensions: 3, embed: vi.fn().mockResolvedValue(DUMMY_VECTOR), embedBatch: vi.fn().mockResolvedValue([DUMMY_VECTOR]) };
  return { asked, mind: AgentMind.create('Denver', { embedder, provider: provider as never, kinds }) };
}

const names = async (kinds?: MindEntryType[]) => (await (await makeMind(kinds).mind).createRunContext()).toolProject.tools.map(t => t.name);

describe('AgentMind kinds', () => {
  it('by default the agent remembers all three kinds and has all seven tools', async () => {
    expect(await names()).toEqual(['mind_recall', 'mind_believe', 'mind_reflect', 'mind_unpin_reflection', 'mind_set_goal', 'mind_update_goal', 'mind_complete_goal']);
  });

  it('with beliefs only it has the recall and believe tools and no goal or reflection tool', async () => {
    expect(await names(['belief'])).toEqual(['mind_recall', 'mind_believe']);
  });

  it('with beliefs and reflections it has no goal tool; with goals only it has no believe or reflect tool', async () => {
    expect(await names(['belief', 'reflection'])).toEqual(['mind_recall', 'mind_believe', 'mind_reflect', 'mind_unpin_reflection']);
    expect(await names(['goal'])).toEqual(['mind_recall', 'mind_set_goal', 'mind_update_goal', 'mind_complete_goal']);
  });

  it('with beliefs only the header never reads goals or reflections from the store', async () => {
    const { mind, asked } = makeMind(['belief']);
    await (await mind).createRunContext();
    expect(asked.some(a => a.filterType === 'goal' || a.filterType === 'reflection')).toBe(false);
    // (Beliefs are still read: something was asked of the store.)
    expect(asked.length).toBeGreaterThan(0);
  });

  it('with beliefs only, mind_recall searches beliefs even when asked for goals, reflections or all, and offers only belief and all', async () => {
    const { mind, asked } = makeMind(['belief']);
    const recall = (await (await mind).createRunContext()).toolProject.tools.find(t => t.name === 'mind_recall')!;
    expect((recall.parameters as { properties: { type: { enum: string[] } } }).properties.type.enum).toEqual(['belief', 'all']);
    asked.length = 0;
    for (const type of ['goal', 'reflection', 'all', 'belief']) await recall.execute({ query: 'the launch', type } as never);
    expect(asked.every(a => a.filterType === 'belief')).toBe(true);
    // 'goal' and 'reflection' search nothing; 'all' and 'belief' search the beliefs.
    expect(asked.length).toBeGreaterThanOrEqual(2);
  });

  it('a list of kinds must name at least one', async () => {
    await expect(makeMind([]).mind).rejects.toThrow(/at least one/);
  });
});
