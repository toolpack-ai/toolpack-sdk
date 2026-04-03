import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryProvider } from '../providers/memory.js';
import { Chunk } from '../interfaces.js';
import { DimensionMismatchError, KnowledgeProviderError } from '../errors.js';

describe('MemoryProvider', () => {
  let provider: MemoryProvider;

  beforeEach(() => {
    provider = new MemoryProvider();
  });

  describe('validateDimensions', () => {
    it('should accept initial dimensions', async () => {
      await expect(provider.validateDimensions(768)).resolves.toBeUndefined();
    });

    it('should accept same dimensions on subsequent calls', async () => {
      await provider.validateDimensions(768);
      await expect(provider.validateDimensions(768)).resolves.toBeUndefined();
    });

    it('should throw on dimension mismatch', async () => {
      await provider.validateDimensions(768);
      await expect(provider.validateDimensions(1536)).rejects.toThrow(DimensionMismatchError);
    });
  });

  describe('add', () => {
    it('should add chunks with vectors', async () => {
      const chunks: Chunk[] = [
        {
          id: 'test-1',
          content: 'Test content',
          metadata: { source: 'test' },
          vector: [0.1, 0.2, 0.3],
        },
      ];

      await expect(provider.add(chunks)).resolves.toBeUndefined();
    });

    it('should throw if chunk missing vector', async () => {
      const chunks: Chunk[] = [
        {
          id: 'test-1',
          content: 'Test content',
          metadata: {},
        },
      ];

      await expect(provider.add(chunks)).rejects.toThrow(KnowledgeProviderError);
    });

    it('should respect maxChunks limit', async () => {
      const limitedProvider = new MemoryProvider({ maxChunks: 2 });
      
      const chunks: Chunk[] = [
        { id: '1', content: 'A', metadata: {}, vector: [0.1] },
        { id: '2', content: 'B', metadata: {}, vector: [0.2] },
      ];

      await limitedProvider.add(chunks);

      const moreChunks: Chunk[] = [
        { id: '3', content: 'C', metadata: {}, vector: [0.3] },
      ];

      await expect(limitedProvider.add(moreChunks)).rejects.toThrow(KnowledgeProviderError);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const chunks: Chunk[] = [
        {
          id: 'doc-1',
          content: 'Machine learning basics',
          metadata: { category: 'ml', hasCode: false },
          vector: [0.9, 0.1, 0.1],
        },
        {
          id: 'doc-2',
          content: 'Deep learning tutorial',
          metadata: { category: 'ml', hasCode: true },
          vector: [0.8, 0.2, 0.1],
        },
        {
          id: 'doc-3',
          content: 'Web development guide',
          metadata: { category: 'web', hasCode: true },
          vector: [0.1, 0.9, 0.1],
        },
      ];

      await provider.add(chunks);
    });

    it('should return similar chunks', async () => {
      const queryVector = [0.85, 0.15, 0.1];
      const results = await provider.query(queryVector, { threshold: 0.5 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.id).toBe('doc-1');
    });

    it('should respect limit parameter', async () => {
      const queryVector = [0.5, 0.5, 0.1];
      const results = await provider.query(queryVector, { limit: 1, threshold: 0 });

      expect(results.length).toBe(1);
    });

    it('should respect threshold parameter', async () => {
      const queryVector = [0.1, 0.1, 0.9];
      const results = await provider.query(queryVector, { threshold: 0.95 });

      expect(results.length).toBe(0);
    });

    it('should filter by metadata', async () => {
      const queryVector = [0.5, 0.5, 0.1];
      const results = await provider.query(queryVector, {
        threshold: 0,
        filter: { category: 'ml' },
      });

      expect(results.length).toBe(2);
      expect(results.every(r => r.chunk.metadata.category === 'ml')).toBe(true);
    });

    it('should filter by metadata with $in operator', async () => {
      const queryVector = [0.5, 0.5, 0.1];
      const results = await provider.query(queryVector, {
        threshold: 0,
        filter: { hasCode: { $in: [true] } },
      });

      expect(results.length).toBe(2);
      expect(results.every(r => r.chunk.metadata.hasCode === true)).toBe(true);
    });

    it('should exclude metadata when includeMetadata is false', async () => {
      const queryVector = [0.9, 0.1, 0.1];
      const results = await provider.query(queryVector, {
        threshold: 0.5,
        includeMetadata: false,
      });

      expect(results[0].chunk.metadata).toEqual({});
    });

    it('should include vectors when includeVectors is true', async () => {
      const queryVector = [0.9, 0.1, 0.1];
      const results = await provider.query(queryVector, {
        threshold: 0.5,
        includeVectors: true,
      });

      expect(results[0].chunk.vector).toBeDefined();
      expect(Array.isArray(results[0].chunk.vector)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete chunks by id', async () => {
      const chunks: Chunk[] = [
        { id: 'test-1', content: 'A', metadata: {}, vector: [0.1] },
        { id: 'test-2', content: 'B', metadata: {}, vector: [0.2] },
      ];

      await provider.add(chunks);
      await provider.delete(['test-1']);

      const results = await provider.query([0.1], { threshold: 0 });
      expect(results.length).toBe(1);
      expect(results[0].chunk.id).toBe('test-2');
    });
  });

  describe('clear', () => {
    it('should clear all chunks and reset dimensions', async () => {
      await provider.validateDimensions(768);
      
      const chunks: Chunk[] = [
        { id: 'test-1', content: 'A', metadata: {}, vector: [0.1] },
      ];
      await provider.add(chunks);

      await provider.clear();

      const results = await provider.query([0.1], { threshold: 0 });
      expect(results.length).toBe(0);

      await expect(provider.validateDimensions(1536)).resolves.toBeUndefined();
    });
  });
});
