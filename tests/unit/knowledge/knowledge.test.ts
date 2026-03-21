import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Knowledge } from '../../../src/knowledge/knowledge.js';
import { MemoryProvider } from '../../../src/knowledge/providers/memory-provider.js';
import { MarkdownSource } from '../../../src/knowledge/sources/markdown-source.js';
import type { Embedder, Chunk } from '../../../src/knowledge/types.js';

class MockEmbedder implements Embedder {
  dimensions = 3;

  async embed(text: string): Promise<number[]> {
    const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return [Math.sin(hash), Math.cos(hash), Math.tan(hash % 1.5)];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

describe('Knowledge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'knowledge-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create knowledge base and sync sources', async () => {
      const content = `# Test

Some content here.
`;
      await fs.promises.writeFile(path.join(tempDir, 'test.md'), content);

      const provider = new MemoryProvider();
      const kb = await Knowledge.create({
        provider,
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
      });

      expect(provider.size).toBeGreaterThan(0);
      await kb.stop();
    });

    it('should throw if no source provided', async () => {
      await expect(
        Knowledge.create({
          provider: new MemoryProvider(),
          embedder: new MockEmbedder(),
        })
      ).rejects.toThrow('At least one source is required');
    });

    it('should support multiple sources', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'doc1.md'), '# Doc 1\nContent 1');
      await fs.promises.writeFile(path.join(tempDir, 'doc2.md'), '# Doc 2\nContent 2');

      const provider = new MemoryProvider();
      const kb = await Knowledge.create({
        provider,
        sources: [
          new MarkdownSource(path.join(tempDir, 'doc1.md')),
          new MarkdownSource(path.join(tempDir, 'doc2.md')),
        ],
        embedder: new MockEmbedder(),
      });

      expect(provider.size).toBe(2);
      await kb.stop();
    });
  });

  describe('query', () => {
    it('should return relevant chunks', async () => {
      await fs.promises.writeFile(
        path.join(tempDir, 'docs.md'),
        `# Installation

Install with npm install toolpack-sdk.

# Usage

Import and use the SDK.
`
      );

      const kb = await Knowledge.create({
        provider: new MemoryProvider(),
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
      });

      const results = await kb.query('how to install', { threshold: 0 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeDefined();
      expect(results[0].chunk.content).toBeDefined();

      await kb.stop();
    });

    it('should respect limit option', async () => {
      await fs.promises.writeFile(
        path.join(tempDir, 'many.md'),
        `# Section 1
Content 1

# Section 2
Content 2

# Section 3
Content 3
`
      );

      const kb = await Knowledge.create({
        provider: new MemoryProvider(),
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
      });

      const results = await kb.query('content', { limit: 2, threshold: 0 });

      expect(results.length).toBeLessThanOrEqual(2);

      await kb.stop();
    });

    it('should filter by metadata', async () => {
      await fs.promises.writeFile(
        path.join(tempDir, 'filtered.md'),
        `---
type: tutorial
---

# Tutorial

Tutorial content.
`
      );

      const kb = await Knowledge.create({
        provider: new MemoryProvider(),
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
      });

      const results = await kb.query('content', {
        filter: { type: 'tutorial' },
        threshold: 0,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.metadata.type).toBe('tutorial');

      await kb.stop();
    });
  });

  describe('sync', () => {
    it('should call onSync callback', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'sync.md'), '# Test\nContent');

      const onSync = vi.fn();

      const kb = await Knowledge.create({
        provider: new MemoryProvider(),
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
        onSync,
      });

      expect(onSync).toHaveBeenCalled();
      expect(onSync).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'add',
          chunksAffected: expect.any(Number),
        })
      );

      await kb.stop();
    });

    it('should clear and re-sync on full sync', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'resync.md'), '# Test\nContent');

      const provider = new MemoryProvider();
      const kb = await Knowledge.create({
        provider,
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
      });

      const initialSize = provider.size;

      await kb.sync();

      expect(provider.size).toBe(initialSize);

      await kb.stop();
    });
  });

  describe('toTool', () => {
    it('should return a tool definition', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'tool.md'), '# Test\nContent');

      const kb = await Knowledge.create({
        provider: new MemoryProvider(),
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
      });

      const tool = kb.toTool();

      expect(tool.name).toBe('knowledge_search');
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');

      await kb.stop();
    });

    it('should execute search via tool', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'search.md'), '# Search\nSearchable content');

      const kb = await Knowledge.create({
        provider: new MemoryProvider(),
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: new MockEmbedder(),
      });

      const tool = kb.toTool();
      const results = await tool.execute({ query: 'searchable' });

      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('content');
        expect(results[0]).toHaveProperty('score');
      }

      await kb.stop();
    });
  });

  describe('error handling', () => {
    it('should call onError callback on embedding failure', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'error.md'), '# Test\nContent');

      const failingEmbedder: Embedder = {
        dimensions: 3,
        embed: vi.fn().mockRejectedValue(new Error('Embedding failed')),
        embedBatch: vi.fn().mockRejectedValue(new Error('Embedding failed')),
      };

      const onError = vi.fn().mockReturnValue('skip');

      const kb = await Knowledge.create({
        provider: new MemoryProvider(),
        source: new MarkdownSource(path.join(tempDir, '*.md')),
        embedder: failingEmbedder,
        onError,
      });

      expect(onError).toHaveBeenCalled();

      await kb.stop();
    });

    it('should abort on error when onError returns abort', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'abort.md'), '# Test\nContent');

      const failingEmbedder: Embedder = {
        dimensions: 3,
        embed: vi.fn().mockRejectedValue(new Error('Embedding failed')),
        embedBatch: vi.fn().mockRejectedValue(new Error('Embedding failed')),
      };

      const onError = vi.fn().mockReturnValue('abort');

      await expect(
        Knowledge.create({
          provider: new MemoryProvider(),
          source: new MarkdownSource(path.join(tempDir, '*.md')),
          embedder: failingEmbedder,
          onError,
        })
      ).rejects.toThrow();
    });
  });
});
