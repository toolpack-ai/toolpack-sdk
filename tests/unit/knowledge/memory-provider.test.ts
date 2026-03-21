import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryProvider } from '../../../src/knowledge/providers/memory-provider.js';
import type { Chunk } from '../../../src/knowledge/types.js';

describe('MemoryProvider', () => {
  let provider: MemoryProvider;

  beforeEach(() => {
    provider = new MemoryProvider();
  });

  describe('add', () => {
    it('should add chunks with vectors', async () => {
      const chunks: Chunk[] = [
        { id: 'chunk1', content: 'Hello world', metadata: {}, vector: [0.1, 0.2, 0.3] },
        { id: 'chunk2', content: 'Goodbye world', metadata: {}, vector: [0.4, 0.5, 0.6] },
      ];

      await provider.add(chunks);
      expect(provider.size).toBe(2);
    });

    it('should throw if chunk has no vector', async () => {
      const chunks: Chunk[] = [
        { id: 'chunk1', content: 'Hello world', metadata: {} },
      ];

      await expect(provider.add(chunks)).rejects.toThrow('has no vector');
    });

    it('should respect maxChunks limit', async () => {
      const limitedProvider = new MemoryProvider({ maxChunks: 2 });

      await limitedProvider.add([
        { id: 'chunk1', content: 'A', metadata: {}, vector: [0.1] },
        { id: 'chunk2', content: 'B', metadata: {}, vector: [0.2] },
      ]);

      await expect(
        limitedProvider.add([{ id: 'chunk3', content: 'C', metadata: {}, vector: [0.3] }])
      ).rejects.toThrow('Maximum chunk limit');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await provider.add([
        { id: 'doc1', content: 'Machine learning basics', metadata: { type: 'tutorial' }, vector: [1, 0, 0] },
        { id: 'doc2', content: 'Deep learning advanced', metadata: { type: 'tutorial' }, vector: [0.9, 0.1, 0] },
        { id: 'doc3', content: 'Cooking recipes', metadata: { type: 'recipe' }, vector: [0, 1, 0] },
      ]);
    });

    it('should return similar chunks based on cosine similarity', async () => {
      const results = await provider.query('', {
        _queryVector: [1, 0, 0],
        limit: 2,
        threshold: 0.5,
      } as any);

      expect(results).toHaveLength(2);
      expect(results[0].chunk.id).toBe('doc1');
      expect(results[0].score).toBeCloseTo(1, 5);
    });

    it('should filter by metadata', async () => {
      const results = await provider.query('', {
        _queryVector: [1, 0, 0],
        filter: { type: 'recipe' },
        threshold: 0,
      } as any);

      expect(results).toHaveLength(1);
      expect(results[0].chunk.id).toBe('doc3');
    });

    it('should support $in filter', async () => {
      const results = await provider.query('', {
        _queryVector: [1, 0, 0],
        filter: { type: { $in: ['tutorial', 'guide'] } },
        threshold: 0,
      } as any);

      expect(results).toHaveLength(2);
    });

    it('should support $gt filter', async () => {
      await provider.add([
        { id: 'doc4', content: 'Version 2', metadata: { version: 2 }, vector: [0.5, 0.5, 0] },
        { id: 'doc5', content: 'Version 5', metadata: { version: 5 }, vector: [0.5, 0.5, 0] },
      ]);

      const results = await provider.query('', {
        _queryVector: [0.5, 0.5, 0],
        filter: { version: { $gt: 3 } },
        threshold: 0,
      } as any);

      expect(results).toHaveLength(1);
      expect(results[0].chunk.metadata.version).toBe(5);
    });

    it('should respect threshold', async () => {
      const results = await provider.query('', {
        _queryVector: [0, 0, 1],
        threshold: 0.9,
      } as any);

      expect(results).toHaveLength(0);
    });

    it('should exclude metadata when includeMetadata is false', async () => {
      const results = await provider.query('', {
        _queryVector: [1, 0, 0],
        limit: 1,
        threshold: 0,
        includeMetadata: false,
      } as any);

      expect(results[0].chunk.metadata).toEqual({});
    });

    it('should include vectors when includeVectors is true', async () => {
      const results = await provider.query('', {
        _queryVector: [1, 0, 0],
        limit: 1,
        threshold: 0,
        includeVectors: true,
      } as any);

      expect(results[0].chunk.vector).toBeDefined();
      expect(results[0].chunk.vector).toEqual([1, 0, 0]);
    });
  });

  describe('delete', () => {
    it('should delete chunks by id', async () => {
      await provider.add([
        { id: 'chunk1', content: 'A', metadata: {}, vector: [0.1] },
        { id: 'chunk2', content: 'B', metadata: {}, vector: [0.2] },
      ]);

      await provider.delete(['chunk1']);
      expect(provider.size).toBe(1);
    });

    it('should handle deleting non-existent ids', async () => {
      await provider.delete(['nonexistent']);
      expect(provider.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all chunks', async () => {
      await provider.add([
        { id: 'chunk1', content: 'A', metadata: {}, vector: [0.1] },
        { id: 'chunk2', content: 'B', metadata: {}, vector: [0.2] },
      ]);

      await provider.clear();
      expect(provider.size).toBe(0);
    });
  });
});
