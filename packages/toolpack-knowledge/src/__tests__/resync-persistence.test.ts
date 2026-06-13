/**
 * Regression tests for the reSync data-loss footgun.
 *
 * Bug: `reSync: false` had to be passed in TWO places — KnowledgeOptions AND
 * PersistentKnowledgeProviderOptions. With it only on Knowledge (the intuitive
 * place), create() consulted provider.shouldReSync(), which read the
 * provider's own (unset) flag, returned true, and ran sync() — whose first
 * step is provider.clear(). Every restart silently wiped all runtime-added
 * chunks (knowledge.add()).
 *
 * Fix: create() forwards the Knowledge-level intent to shouldReSync(); the
 * provider's own explicit flag still wins when set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Knowledge } from '../knowledge.js';
import { PersistentKnowledgeProvider } from '../providers/persistent.js';
import { Chunk, Embedder, KnowledgeSource } from '../interfaces.js';

function createMockEmbedder(dimensions = 3): Embedder {
  return {
    dimensions,
    embed: vi.fn(async () => new Array(dimensions).fill(0).map(() => Math.random())),
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map(() => new Array(dimensions).fill(0).map(() => Math.random()))
    ),
  };
}

function createMockSource(chunks: Chunk[]): KnowledgeSource {
  return {
    async *load() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe('reSync persistence (data-loss regression)', () => {
  let tmpDir: string;
  let embedder: Embedder;

  // Each "restart" constructs a fresh provider over the same on-disk store,
  // exactly like a new process would.
  const makeProvider = (opts: { reSync?: boolean } = {}) =>
    new PersistentKnowledgeProvider({ namespace: 'resync-test', storagePath: tmpDir, ...opts });

  const chunkCount = (provider: PersistentKnowledgeProvider) =>
    provider.getAllChunks().then((c) => c.length);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-resync-'));
    embedder = createMockEmbedder(3);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('chunk added via knowledge.add() survives a second create() with reSync:false only at the Knowledge level', async () => {
    // Process 1: provider WITHOUT its own reSync flag — the footgun setup.
    const provider1 = makeProvider();
    const kb1 = await Knowledge.create({
      provider: provider1,
      sources: [],
      embedder,
      description: 'test',
      reSync: false, // only here — previously insufficient
    });
    await kb1.add('runtime-added fact: the secret number is 1240');
    expect(await chunkCount(provider1)).toBe(1);
    provider1.close();

    // Process 2 (simulated restart): fresh provider over the same store.
    const provider2 = makeProvider();
    await Knowledge.create({
      provider: provider2,
      sources: [],
      embedder,
      description: 'test',
      reSync: false,
    });

    // Pre-fix: create() ran sync() → clear() → 0 chunks.
    expect(await chunkCount(provider2)).toBe(1);
    provider2.close();
  });

  it('still syncs sources on first run (empty store) when reSync is false', async () => {
    const provider = makeProvider();
    await Knowledge.create({
      provider,
      sources: [createMockSource([{ id: 's1', content: 'seeded doc', metadata: {} }])],
      embedder,
      description: 'test',
      reSync: false,
    });

    // Empty store → initial sync must still happen so sources get indexed.
    expect(await chunkCount(provider)).toBe(1);
    provider.close();
  });

  it('default behavior unchanged: create() without reSync re-syncs (clears) the store', async () => {
    const provider1 = makeProvider();
    const kb1 = await Knowledge.create({
      provider: provider1,
      sources: [],
      embedder,
      description: 'test',
      // no reSync flag anywhere → full sync is the documented default
    });
    await kb1.add('volatile chunk');
    expect(await chunkCount(provider1)).toBe(1);
    provider1.close();

    const provider2 = makeProvider();
    await Knowledge.create({
      provider: provider2,
      sources: [],
      embedder,
      description: 'test',
    });
    expect(await chunkCount(provider2)).toBe(0);
    provider2.close();
  });

  it('provider-level explicit reSync overrides the Knowledge-level flag', async () => {
    const provider1 = makeProvider({ reSync: true });
    const kb1 = await Knowledge.create({
      provider: provider1,
      sources: [],
      embedder,
      description: 'test',
      reSync: false,
    });
    await kb1.add('chunk the provider explicitly wants resynced away');
    provider1.close();

    // Provider says reSync: true explicitly — that wins over Knowledge-level false.
    const provider2 = makeProvider({ reSync: true });
    await Knowledge.create({
      provider: provider2,
      sources: [],
      embedder,
      description: 'test',
      reSync: false,
    });
    expect(await chunkCount(provider2)).toBe(0);
    provider2.close();
  });

  it('mirror case: reSync:false only on the PROVIDER also preserves runtime adds (README example)', async () => {
    // The package README's first example sets reSync: false only on the
    // provider — pre-fix, create() never consulted shouldReSync() unless the
    // Knowledge-level flag was false, so this documented setup also wiped
    // (and re-embedded) on every restart.
    const provider1 = makeProvider({ reSync: false });
    const kb1 = await Knowledge.create({
      provider: provider1,
      sources: [],
      embedder,
      description: 'test',
      // no Knowledge-level reSync
    });
    await kb1.add('runtime fact stored with provider-only flag');
    provider1.close();

    const provider2 = makeProvider({ reSync: false });
    await Knowledge.create({
      provider: provider2,
      sources: [],
      embedder,
      description: 'test',
    });
    expect(await chunkCount(provider2)).toBe(1);
    provider2.close();
  });

  it('explicit Knowledge-level reSync:true forces a full re-sync even with provider reSync:false', async () => {
    const provider1 = makeProvider({ reSync: false });
    const kb1 = await Knowledge.create({
      provider: provider1,
      sources: [],
      embedder,
      description: 'test',
      reSync: false,
    });
    await kb1.add('chunk to be wiped by an explicit reSync demand');
    provider1.close();

    const provider2 = makeProvider({ reSync: false });
    await Knowledge.create({
      provider: provider2,
      sources: [],
      embedder,
      description: 'test',
      reSync: true, // explicit demand wins — e.g. a deliberate re-index run
    });
    expect(await chunkCount(provider2)).toBe(0);
    provider2.close();
  });

  it('dual-flag setup (both reSync: false) keeps working as before', async () => {
    const provider1 = makeProvider({ reSync: false });
    const kb1 = await Knowledge.create({
      provider: provider1,
      sources: [],
      embedder,
      description: 'test',
      reSync: false,
    });
    await kb1.add('belt-and-braces chunk');
    provider1.close();

    const provider2 = makeProvider({ reSync: false });
    await Knowledge.create({
      provider: provider2,
      sources: [],
      embedder,
      description: 'test',
      reSync: false,
    });
    expect(await chunkCount(provider2)).toBe(1);
    provider2.close();
  });
});
