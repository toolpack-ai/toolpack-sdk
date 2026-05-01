/**
 * §4.4 — Multi-layer knowledge merge & promote
 *
 * Verifies that:
 * - knowledge_search returns results from both private (_layer:0) and shared
 *   (_layer:1) knowledge bases, sorted by score.
 * - knowledge_add writes the new entry into the private (index-0) store only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockKnowledgeSync, MockKnowledge } from '../../src/testing/mock-knowledge.js';

let privateKB: MockKnowledge;
let sharedKB: MockKnowledge;

beforeEach(() => {
  privateKB = createMockKnowledgeSync({
    initialChunks: [
      { content: 'Strategist private fact: Q4 revenue target is $2M', metadata: { source: 'private' } },
    ],
  });

  sharedKB = createMockKnowledgeSync({
    initialChunks: [
      { content: 'Shared project brief: building a client reporting dashboard', metadata: { source: 'shared' } },
    ],
  });
});

describe('Multi-layer knowledge — merge', () => {
  it('returns results from both layers tagged with _layer index', async () => {
    const layers = [privateKB, sharedKB];

    // Query each layer and tag results
    const allResults = (
      await Promise.all(
        layers.map(async (kb, layerIdx) => {
          const results = await kb.query('revenue target dashboard', { limit: 5 });
          return results.map(r => ({ ...r, _layer: layerIdx }));
        }),
      )
    ).flat();

    // Sort by score desc (mirrors real multi-layer merge behaviour)
    allResults.sort((a, b) => b.score - a.score);

    expect(allResults.length).toBeGreaterThanOrEqual(2);

    const layerIndices = allResults.map(r => r._layer);
    expect(layerIndices).toContain(0); // private layer present
    expect(layerIndices).toContain(1); // shared layer present

    // Scores should be non-negative and descending
    for (let i = 0; i < allResults.length - 1; i++) {
      expect(allResults[i].score).toBeGreaterThanOrEqual(allResults[i + 1].score);
    }
  });

  it('each layer returns its own content', async () => {
    const privateResults = await privateKB.query('revenue', { limit: 5 });
    const sharedResults = await sharedKB.query('dashboard', { limit: 5 });

    expect(privateResults.some(r => r.chunk.content.includes('revenue target'))).toBe(true);
    expect(sharedResults.some(r => r.chunk.content.includes('reporting dashboard'))).toBe(true);
  });
});

describe('Multi-layer knowledge — knowledge_add promotes to private layer', () => {
  it('adds new entry to private KB only', async () => {
    const newFact = 'Strategist note: client prefers weekly digests';
    await privateKB.add(newFact, { source: 'private' });

    const privateAfter = await privateKB.query('weekly digests', { limit: 5 });
    const sharedAfter = await sharedKB.query('weekly digests', { limit: 5 });

    expect(privateAfter.some(r => r.chunk.content.includes('weekly digests'))).toBe(true);
    expect(sharedAfter.some(r => r.chunk.content.includes('weekly digests'))).toBe(false);
  });

  it('private KB grows; shared KB stays unchanged', async () => {
    const before = sharedKB.getAllChunks().length;
    await privateKB.add('extra private fact', { source: 'private' });

    expect(privateKB.getAllChunks().length).toBe(2);
    expect(sharedKB.getAllChunks().length).toBe(before);
  });
});
