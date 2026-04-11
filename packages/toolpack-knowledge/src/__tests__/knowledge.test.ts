import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Knowledge } from '../knowledge.js';
import { MemoryProvider } from '../providers/memory.js';
import { Chunk, Embedder, KnowledgeSource } from '../interfaces.js';

function createMockEmbedder(dimensions = 3): Embedder {
  return {
    dimensions,
    embed: vi.fn(async (_text: string) => {
      const vec = new Array(dimensions).fill(0).map(() => Math.random());
      return vec;
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      return texts.map(() => new Array(dimensions).fill(0).map(() => Math.random()));
    }),
  };
}

function createMockSource(chunks: Chunk[]): KnowledgeSource {
  return {
    async *load() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe('Knowledge', () => {
  let provider: MemoryProvider;
  let embedder: Embedder;

  beforeEach(() => {
    provider = new MemoryProvider();
    embedder = createMockEmbedder(3);
  });

  describe('create', () => {
    it('should create a Knowledge instance and sync sources', async () => {
      const source = createMockSource([
        { id: 'c1', content: 'Hello world', metadata: {} },
        { id: 'c2', content: 'Goodbye world', metadata: {} },
      ]);

      const onSync = vi.fn();

      const kb = await Knowledge.create({
        provider,
        sources: [source],
        embedder,
        description: 'Test knowledge base',
        onSync,
      });

      expect(kb).toBeDefined();
      expect(onSync).toHaveBeenCalledWith({ type: 'start' });
      expect(onSync).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'complete', chunksAffected: 2 })
      );
    });

    it('should validate dimensions before syncing', async () => {
      const source = createMockSource([]);

      await expect(
        Knowledge.create({
          provider,
          sources: [source],
          embedder: createMockEmbedder(768),
          description: 'Test',
        })
      ).resolves.toBeDefined();

      await expect(
        Knowledge.create({
          provider,
          sources: [source],
          embedder: createMockEmbedder(1536),
          description: 'Test',
        })
      ).rejects.toThrow('Dimension mismatch');
    });

    it('should not sync when reSync is false', async () => {
      const source = createMockSource([
        { id: 'c1', content: 'Hello', metadata: {} },
      ]);

      const kb = await Knowledge.create({
        provider,
        sources: [source],
        embedder,
        description: 'Test',
        reSync: false,
      });

      expect(kb).toBeDefined();
      expect(embedder.embed).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('should embed query text and return results', async () => {
      const fixedVector = [0.9, 0.1, 0.1];
      const fixedEmbedder: Embedder = {
        dimensions: 3,
        embed: vi.fn(async () => fixedVector),
        embedBatch: vi.fn(async (texts: string[]) => texts.map(() => fixedVector)),
      };

      const source = createMockSource([
        { id: 'c1', content: 'Test content', metadata: {} },
      ]);

      const kb = await Knowledge.create({
        provider,
        sources: [source],
        embedder: fixedEmbedder,
        description: 'Test',
      });

      const results = await kb.query('test');
      expect(results.length).toBe(1);
      expect(results[0].score).toBeCloseTo(1.0, 2);
      expect(results[0].chunk.content).toBe('Test content');
    });
  });

  describe('sync — skip handling (bug fix verification)', () => {
    it('should not misalign vectors when onError returns skip', async () => {
      let callCount = 0;
      const failOnSecondEmbedder: Embedder = {
        dimensions: 3,
        embed: vi.fn(async () => {
          callCount++;
          if (callCount === 2) {
            throw new Error('Embedding failed for chunk 2');
          }
          return [0.5, 0.5, 0.1];
        }),
        embedBatch: vi.fn(async () => { throw new Error('Batch not supported'); }),
      };

      const source = createMockSource([
        { id: 'c1', content: 'Chunk 1', metadata: {} },
        { id: 'c2', content: 'Chunk 2 (will fail)', metadata: {} },
        { id: 'c3', content: 'Chunk 3', metadata: {} },
      ]);

      const onError = vi.fn(() => 'skip' as const);

      const kb = await Knowledge.create({
        provider,
        sources: [source],
        embedder: failOnSecondEmbedder,
        description: 'Test',
        onError,
      });

      // Called once for batch error (skip → fallback) + once for chunk 2 individual error (skip)
      expect(onError).toHaveBeenCalledTimes(2);

      const results = await kb.query('test', { threshold: 0 });
      expect(results.length).toBe(2);

      const ids = results.map(r => r.chunk.id).sort();
      expect(ids).toEqual(['c1', 'c3']);
    });

    it('should abort sync when onError returns abort', async () => {
      const failEmbedder: Embedder = {
        dimensions: 3,
        embed: vi.fn(async () => {
          throw new Error('Always fails');
        }),
        embedBatch: vi.fn(async () => { throw new Error('Batch failed'); }),
      };

      const source = createMockSource([
        { id: 'c1', content: 'Chunk 1', metadata: {} },
      ]);

      let callCount = 0;
      const onError = vi.fn(() => {
        callCount++;
        // Skip batch error to trigger fallback, abort on individual embed error
        return callCount === 1 ? 'skip' as const : 'abort' as const;
      });

      await expect(
        Knowledge.create({
          provider,
          sources: [source],
          embedder: failEmbedder,
          description: 'Test',
          onError,
        })
      ).rejects.toThrow('Always fails');
    });
  });

  describe('onEmbeddingProgress', () => {
    it('should fire progress events per chunk', async () => {
      const source = createMockSource([
        { id: 'c1', content: 'A', metadata: {} },
        { id: 'c2', content: 'B', metadata: {} },
        { id: 'c3', content: 'C', metadata: {} },
      ]);

      const progressEvents: Array<{ current: number; total: number; percent: number }> = [];

      await Knowledge.create({
        provider,
        sources: [source],
        embedder,
        description: 'Test',
        onEmbeddingProgress: (event) => progressEvents.push(event),
      });

      expect(progressEvents.length).toBe(3);
      expect(progressEvents[0]).toEqual({ source: 'sync', current: 1, total: 3, percent: 33 });
      expect(progressEvents[1]).toEqual({ source: 'sync', current: 2, total: 3, percent: 67 });
      expect(progressEvents[2]).toEqual({ source: 'sync', current: 3, total: 3, percent: 100 });
    });
  });

  describe('toTool', () => {
    it('should generate a valid tool definition', async () => {
      const source = createMockSource([]);

      const kb = await Knowledge.create({
        provider,
        sources: [source],
        embedder,
        description: 'Search SDK docs for setup and API info',
      });

      const tool = kb.toTool();

      expect(tool.name).toBe('knowledge_search');
      expect(tool.description).toBe('Search SDK docs for setup and API info');
      expect(tool.parameters.required).toEqual(['query']);
      expect(tool.parameters.properties).toHaveProperty('query');
      expect(tool.parameters.properties).toHaveProperty('limit');
      expect(tool.parameters.properties).toHaveProperty('threshold');
      expect(tool.parameters.properties).toHaveProperty('filter');
    });

    it('should execute queries through the tool', async () => {
      const fixedVector = [0.9, 0.1, 0.1];
      const fixedEmbedder: Embedder = {
        dimensions: 3,
        embed: vi.fn(async () => fixedVector),
        embedBatch: vi.fn(async (texts: string[]) => texts.map(() => fixedVector)),
      };

      const source = createMockSource([
        { id: 'c1', content: 'Installation guide', metadata: { hasCode: true } },
      ]);

      const kb = await Knowledge.create({
        provider,
        sources: [source],
        embedder: fixedEmbedder,
        description: 'Test',
      });

      const tool = kb.toTool();
      const results = await tool.execute({ query: 'install' });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe('Installation guide');
      expect(results[0].score).toBeCloseTo(1.0, 2);
      expect(results[0].metadata).toEqual({ hasCode: true });
    });
  });

  describe('multi-source', () => {
    it('should ingest from multiple sources', async () => {
      const source1 = createMockSource([
        { id: 'src1-c1', content: 'Source 1 chunk', metadata: { source: 'a' } },
      ]);
      const source2 = createMockSource([
        { id: 'src2-c1', content: 'Source 2 chunk', metadata: { source: 'b' } },
      ]);

      const fixedVector = [0.5, 0.5, 0.1];
      const fixedEmbedder: Embedder = {
        dimensions: 3,
        embed: vi.fn(async () => fixedVector),
        embedBatch: vi.fn(async (texts: string[]) => texts.map(() => fixedVector)),
      };

      const kb = await Knowledge.create({
        provider,
        sources: [source1, source2],
        embedder: fixedEmbedder,
        description: 'Test',
      });

      const results = await kb.query('test', { threshold: 0 });
      expect(results.length).toBe(2);
    });
  });

  describe('add', () => {
    it('should add single content with metadata', async () => {
      const kb = await Knowledge.create({
        provider,
        sources: [],
        embedder: createMockEmbedder(),
        description: 'Test',
      });

      const id = await kb.add('Test conversation message', {
        role: 'user',
        conversationId: 'conv-123',
        timestamp: new Date().toISOString(),
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should add content without metadata', async () => {
      const kb = await Knowledge.create({
        provider,
        sources: [],
        embedder: createMockEmbedder(),
        description: 'Test',
      });

      const id = await kb.add('Simple content');

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should throw on embedder failure', async () => {
      const failingEmbedder = createMockEmbedder();
      failingEmbedder.embed = vi.fn().mockRejectedValue(new Error('Embedding failed'));

      const kb = await Knowledge.create({
        provider,
        sources: [],
        embedder: failingEmbedder,
        description: 'Test',
      });

      await expect(kb.add('Test content')).rejects.toThrow('Failed to add content');
    });

    it('should throw on provider failure', async () => {
      provider.add = vi.fn().mockRejectedValue(new Error('Provider error'));

      const kb = await Knowledge.create({
        provider,
        sources: [],
        embedder: createMockEmbedder(),
        description: 'Test',
      });

      await expect(kb.add('Test content')).rejects.toThrow('Failed to add content');
    });
  });
});
