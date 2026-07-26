import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DraftBuffer } from './draft-buffer.js';
import type { MindStore } from './store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DUMMY_VECTOR = [1, 0, 0]; // constant; avoids accidental cosine-dedup between tests

function makeStore(overrides: Partial<Record<keyof MindStore, unknown>> = {}): MindStore {
  return {
    embed: vi.fn().mockResolvedValue(DUMMY_VECTOR),
    embedBatch: vi.fn().mockResolvedValue([DUMMY_VECTOR]),
    findSimilarBelief: vi.fn().mockResolvedValue(null),
    getActiveGoalCount: vi.fn().mockResolvedValue(0),
    getPinnedReflectionCount: vi.fn().mockResolvedValue(0),
    getActiveGoals: vi.fn().mockResolvedValue([]),
    getPinnedReflections: vi.fn().mockResolvedValue([]),
    getHighConfidenceBeliefs: vi.fn().mockResolvedValue([]),
    getRecentBeliefs: vi.fn().mockResolvedValue([]),
    getRecentReflections: vi.fn().mockResolvedValue([]),
    searchBeliefs: vi.fn().mockResolvedValue([]),
    searchReflections: vi.fn().mockResolvedValue([]),
    searchGoals: vi.fn().mockResolvedValue([]),
    addBelief: vi.fn().mockResolvedValue('belief-id'),
    updateBelief: vi.fn().mockResolvedValue(undefined),
    addReflection: vi.fn().mockResolvedValue('reflection-id'),
    updateReflection: vi.fn().mockResolvedValue(undefined),
    addGoal: vi.fn().mockResolvedValue('goal-id'),
    updateGoal: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MindStore;
}

function makeBuffer(
  store: MindStore,
  opts: {
    maxGoals?: number;
    maxPinnedReflections?: number;
    committedGoalCount?: number;
    committedPinnedCount?: number;
    inFlightBeliefs?: Set<string>;
  } = {},
): DraftBuffer {
  return new DraftBuffer(
    store,
    0.85,                                          // deduplicationThreshold
    opts.maxGoals ?? 10,
    opts.maxPinnedReflections ?? 10,
    opts.committedGoalCount ?? 0,
    opts.committedPinnedCount ?? 0,
    opts.inFlightBeliefs ?? new Set(),
  );
}

// ---------------------------------------------------------------------------
// Issue 3 — flush-time goal cap
// ---------------------------------------------------------------------------

describe('Issue 3 — flush-time goal cap', () => {
  it('drops the second goal when both runs flush and the cap is reached between flushes', async () => {
    // Store has 9 committed goals; cap is 10. Two concurrent runs both read 9
    // and each draft one more goal, so both pass the draft-time check (9+1=10).
    // At flush time the store is queried live. The first flush sees 9 → writes.
    // The second flush sees 10 → drops.
    const goalCountSequence = [
      9,  // run-A reads at flush time → below cap, write allowed
      10, // run-B reads at flush time → at cap, drop
    ];
    const store = makeStore({
      getActiveGoalCount: vi.fn().mockImplementation(() =>
        Promise.resolve(goalCountSequence.shift() ?? 10),
      ),
    });

    const bufferA = makeBuffer(store, { maxGoals: 10, committedGoalCount: 9 });
    const bufferB = makeBuffer(store, { maxGoals: 10, committedGoalCount: 9 });

    bufferA.addSetGoal({ description: 'Goal from run A', priority: 'normal', tags: [] });
    bufferB.addSetGoal({ description: 'Goal from run B', priority: 'normal', tags: [] });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bufferA.flushClean();
    await bufferB.flushClean();

    // Only one goal must reach the store
    expect(store.addGoal).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('goal cap'));

    warnSpy.mockRestore();
  });

  it('allows both goals when the cap is not reached', async () => {
    // 8 committed, cap 10 — both runs should write without issue
    const store = makeStore({
      getActiveGoalCount: vi.fn()
        .mockResolvedValueOnce(8)  // run-A flush
        .mockResolvedValueOnce(9), // run-B flush (after A wrote)
    });

    const bufferA = makeBuffer(store, { maxGoals: 10, committedGoalCount: 8 });
    const bufferB = makeBuffer(store, { maxGoals: 10, committedGoalCount: 8 });

    bufferA.addSetGoal({ description: 'Goal A', priority: 'normal', tags: [] });
    bufferB.addSetGoal({ description: 'Goal B', priority: 'normal', tags: [] });

    await bufferA.flushClean();
    await bufferB.flushClean();

    expect(store.addGoal).toHaveBeenCalledTimes(2);
  });

  it('drops the second pinned reflection when the pinned cap is reached at flush time', async () => {
    const pinnedCountSequence = [9, 10];
    const store = makeStore({
      getPinnedReflectionCount: vi.fn().mockImplementation(() =>
        Promise.resolve(pinnedCountSequence.shift() ?? 10),
      ),
    });

    const bufferA = makeBuffer(store, { maxPinnedReflections: 10, committedPinnedCount: 9 });
    const bufferB = makeBuffer(store, { maxPinnedReflections: 10, committedPinnedCount: 9 });

    await bufferA.addReflect({ content: 'Pinned rule A', pinned: true, tags: [] });
    await bufferB.addReflect({ content: 'Pinned rule B', pinned: true, tags: [] });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bufferA.flushClean();
    await bufferB.flushClean();

    expect(store.addReflection).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pinned reflection cap'));

    warnSpy.mockRestore();
  });

  it('does NOT re-check the live count for un-pinned reflections (no cap enforcement)', async () => {
    // Un-pinned reflections have no cap; getPinnedReflectionCount should not be
    // called during flush for un-pinned entries.
    const store = makeStore();

    const buffer = makeBuffer(store);
    await buffer.addReflect({ content: 'Regular reflection', pinned: false, tags: [] });
    await buffer.flushClean();

    // getPinnedReflectionCount may be called 0 times for un-pinned reflections
    expect(store.addReflection).toHaveBeenCalledTimes(1);
    // The pinned-count check should NOT fire for un-pinned reflections
    expect(store.getPinnedReflectionCount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issue 6 — in-flight belief dedup across concurrent DraftBuffers
// ---------------------------------------------------------------------------

describe('Issue 6 — in-flight belief dedup', () => {
  let sharedInFlight: Set<string>;
  let store: MindStore;

  beforeEach(() => {
    sharedInFlight = new Set();
    store = makeStore();
  });

  it('blocks the second concurrent addBelieve with identical content', async () => {
    const bufferA = makeBuffer(store, { inFlightBeliefs: sharedInFlight });
    const bufferB = makeBuffer(store, { inFlightBeliefs: sharedInFlight });

    const input = { content: 'User prefers dark mode', confidence: 'high' as const, tags: [], allowDowngrade: false };

    const resultA = await bufferA.addBelieve(input);
    const resultB = await bufferB.addBelieve(input); // same content, before A flushes

    expect(resultA.action).toBe('created');
    expect(resultB.action).toBe('updated_draft');
    expect(resultB.id).toBe('in-flight-dedup');

    // Only A's belief reaches the store on flush; B had nothing to write
    await bufferA.flushClean();
    await bufferB.flushClean();
    expect(store.addBelief).toHaveBeenCalledTimes(1);
  });

  it('releases the in-flight slot after flush so subsequent runs can write the belief', async () => {
    const bufferA = makeBuffer(store, { inFlightBeliefs: sharedInFlight });
    const input = { content: 'User prefers dark mode', confidence: 'high' as const, tags: [], allowDowngrade: false };

    await bufferA.addBelieve(input);
    expect(sharedInFlight.size).toBe(1); // slot claimed

    await bufferA.flushClean();
    expect(sharedInFlight.size).toBe(0); // slot released after flush

    // A second run can now write the same belief (e.g. after a new fact is observed)
    const bufferC = makeBuffer(store, { inFlightBeliefs: sharedInFlight });
    // findSimilarBelief still returns null — store mock doesn't persist writes
    const resultC = await bufferC.addBelieve(input);
    expect(resultC.action).toBe('created');
  });

  it('releases the in-flight slot even when flush encounters an error', async () => {
    const bufferA = makeBuffer(store, { inFlightBeliefs: sharedInFlight });
    const input = { content: 'User prefers dark mode', confidence: 'high' as const, tags: [], allowDowngrade: false };

    await bufferA.addBelieve(input);
    expect(sharedInFlight.size).toBe(1);

    await bufferA.flushOnError();
    expect(sharedInFlight.size).toBe(0); // slot released on error flush too
  });

  it('allows two different belief contents from concurrent runs', async () => {
    const bufferA = makeBuffer(store, { inFlightBeliefs: sharedInFlight });
    const bufferB = makeBuffer(store, { inFlightBeliefs: sharedInFlight });

    const resultA = await bufferA.addBelieve({ content: 'User prefers dark mode', confidence: 'high', tags: [], allowDowngrade: false });
    const resultB = await bufferB.addBelieve({ content: 'User is based in Berlin', confidence: 'medium', tags: [], allowDowngrade: false });

    expect(resultA.action).toBe('created');
    expect(resultB.action).toBe('created');
    expect(sharedInFlight.size).toBe(2);

    await bufferA.flushClean();
    await bufferB.flushClean();
    expect(store.addBelief).toHaveBeenCalledTimes(2);
    expect(sharedInFlight.size).toBe(0);
  });
});
