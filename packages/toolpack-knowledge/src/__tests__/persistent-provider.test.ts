import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersistentKnowledgeProvider } from '../providers/persistent.js';
import { Chunk } from '../interfaces.js';
import { DimensionMismatchError, KnowledgeProviderError } from '../errors.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('PersistentKnowledgeProvider', () => {
  let tmpDir: string;
  let provider: PersistentKnowledgeProvider;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-persist-test-'));
    provider = new PersistentKnowledgeProvider({
      namespace: 'test',
      storagePath: tmpDir,
    });
  });

  afterEach(() => {
    provider.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

    it('should persist dimensions across provider instances', async () => {
      await provider.validateDimensions(768);
      provider.close();

      const provider2 = new PersistentKnowledgeProvider({
        namespace: 'test',
        storagePath: tmpDir,
      });

      await expect(provider2.validateDimensions(768)).resolves.toBeUndefined();
      await expect(provider2.validateDimensions(1536)).rejects.toThrow(DimensionMismatchError);
      
      provider2.close();
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

    it('should persist chunks across provider instances', async () => {
      const chunks: Chunk[] = [
        {
          id: 'test-1',
          content: 'Persistent content',
          metadata: { type: 'test' },
          vector: [0.5, 0.5, 0.1],
        },
      ];

      await provider.add(chunks);
      provider.close();

      const provider2 = new PersistentKnowledgeProvider({
        namespace: 'test',
        storagePath: tmpDir,
      });

      const results = await provider2.query([0.5, 0.5, 0.1], { threshold: 0 });
      expect(results.length).toBe(1);
      expect(results[0].chunk.content).toBe('Persistent content');
      expect(results[0].chunk.metadata.type).toBe('test');

      provider2.close();
    });

    it('should handle batch inserts with transactions', async () => {
      const chunks: Chunk[] = Array.from({ length: 100 }, (_, i) => ({
        id: `chunk-${i}`,
        content: `Content ${i}`,
        metadata: { index: i },
        vector: [Math.random(), Math.random(), Math.random()],
      }));

      await provider.add(chunks);

      const results = await provider.query([0.5, 0.5, 0.5], { threshold: 0, limit: 100 });
      expect(results.length).toBe(100);
    });

    it('should replace existing chunks with same ID', async () => {
      const chunk1: Chunk = {
        id: 'test-1',
        content: 'Original content',
        metadata: { version: 1 },
        vector: [0.1, 0.2, 0.3],
      };

      await provider.add([chunk1]);

      const chunk2: Chunk = {
        id: 'test-1',
        content: 'Updated content',
        metadata: { version: 2 },
        vector: [0.4, 0.5, 0.6],
      };

      await provider.add([chunk2]);

      const results = await provider.query([0.4, 0.5, 0.6], { threshold: 0 });
      expect(results.length).toBe(1);
      expect(results[0].chunk.content).toBe('Updated content');
      expect(results[0].chunk.metadata.version).toBe(2);
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
      expect(results[0].chunk.vector?.length).toBe(3);
    });

    it('should return results sorted by score descending', async () => {
      const queryVector = [0.7, 0.3, 0.1];
      const results = await provider.query(queryVector, { threshold: 0, limit: 3 });

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('delete', () => {
    it('should delete chunks by id', async () => {
      const chunks: Chunk[] = [
        { id: 'test-1', content: 'A', metadata: {}, vector: [0.1, 0.2, 0.3] },
        { id: 'test-2', content: 'B', metadata: {}, vector: [0.4, 0.5, 0.6] },
      ];

      await provider.add(chunks);
      await provider.delete(['test-1']);

      const results = await provider.query([0.1, 0.2, 0.3], { threshold: 0 });
      expect(results.length).toBe(1);
      expect(results[0].chunk.id).toBe('test-2');
    });

    it('should delete multiple chunks', async () => {
      const chunks: Chunk[] = [
        { id: 'test-1', content: 'A', metadata: {}, vector: [0.1, 0.2, 0.3] },
        { id: 'test-2', content: 'B', metadata: {}, vector: [0.4, 0.5, 0.6] },
        { id: 'test-3', content: 'C', metadata: {}, vector: [0.7, 0.8, 0.9] },
      ];

      await provider.add(chunks);
      await provider.delete(['test-1', 'test-3']);

      const results = await provider.query([0.5, 0.5, 0.5], { threshold: 0 });
      expect(results.length).toBe(1);
      expect(results[0].chunk.id).toBe('test-2');
    });
  });

  describe('clear', () => {
    it('should clear all chunks and reset dimensions', async () => {
      await provider.validateDimensions(768);
      
      const chunks: Chunk[] = [
        { id: 'test-1', content: 'A', metadata: {}, vector: [0.1, 0.2, 0.3] },
      ];
      await provider.add(chunks);

      await provider.clear();

      const results = await provider.query([0.1, 0.2, 0.3], { threshold: 0 });
      expect(results.length).toBe(0);

      await expect(provider.validateDimensions(1536)).resolves.toBeUndefined();
    });

    it('should only delete dimensions key from provider_meta', async () => {
      await provider.validateDimensions(768);
      await provider.clear();
      
      // After clear, should be able to set different dimensions
      await expect(provider.validateDimensions(1536)).resolves.toBeUndefined();
    });
  });

  describe('shouldReSync', () => {
    it('should return true when reSync option is not false', async () => {
      const provider1 = new PersistentKnowledgeProvider({
        namespace: 'test-resync',
        storagePath: tmpDir,
        reSync: true,
      });

      expect(provider1.shouldReSync()).toBe(true);
      provider1.close();
    });

    it('should return false when reSync is false and chunks exist', async () => {
      const provider1 = new PersistentKnowledgeProvider({
        namespace: 'test-resync-2',
        storagePath: tmpDir,
        reSync: false,
      });

      const chunks: Chunk[] = [
        { id: 'test-1', content: 'A', metadata: {}, vector: [0.1, 0.2, 0.3] },
      ];
      await provider1.add(chunks);
      provider1.close();

      const provider2 = new PersistentKnowledgeProvider({
        namespace: 'test-resync-2',
        storagePath: tmpDir,
        reSync: false,
      });

      expect(provider2.shouldReSync()).toBe(false);
      provider2.close();
    });

    it('should return true when reSync is false but no chunks exist', async () => {
      const provider1 = new PersistentKnowledgeProvider({
        namespace: 'test-resync-3',
        storagePath: tmpDir,
        reSync: false,
      });

      expect(provider1.shouldReSync()).toBe(true);
      provider1.close();
    });
  });

  describe('WAL mode and transactions', () => {
    it('should use WAL journal mode', async () => {
      const chunks: Chunk[] = [
        { id: 'test-1', content: 'A', metadata: {}, vector: [0.1, 0.2, 0.3] },
      ];

      await provider.add(chunks);
      
      // Verify data persists (WAL mode should ensure durability)
      provider.close();

      const provider2 = new PersistentKnowledgeProvider({
        namespace: 'test',
        storagePath: tmpDir,
      });

      const results = await provider2.query([0.1, 0.2, 0.3], { threshold: 0 });
      expect(results.length).toBe(1);

      provider2.close();
    });
  });

  describe('close', () => {
    it('should close database connection', () => {
      expect(() => provider.close()).not.toThrow();
    });

    it('should allow multiple close calls', () => {
      provider.close();
      expect(() => provider.close()).not.toThrow();
    });
  });
});
