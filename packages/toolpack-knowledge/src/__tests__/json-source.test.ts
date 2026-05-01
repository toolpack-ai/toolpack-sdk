import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { JSONSource } from '../sources/json.js';

const defaultToContent = (item: unknown) =>
  typeof item === 'object' && item !== null
    ? (item as { name?: string }).name ?? JSON.stringify(item)
    : String(item);

describe('JSONSource', () => {
  let tempDir: string;
  let testFile: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'json-source-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should throw if toContent is not provided', () => {
      expect(() => {
        new JSONSource('/path/to/file.json', {} as { toContent: (item: unknown) => string });
      }).toThrow('JSONSource requires a toContent callback');
    });
  });

  describe('load', () => {
    it('should load single object from JSON file', async () => {
      testFile = path.join(tempDir, 'single.json');
      await fs.writeFile(testFile, JSON.stringify({ name: 'Test', value: 42 }));

      const source = new JSONSource(testFile, {
        toContent: (item) => `Name: ${(item as { name: string }).name}, Value: ${(item as { value: number }).value}`,
      });
      const chunks: Awaited<ReturnType<typeof source.load.next>>[] = [];

      for await (const chunk of source.load()) {
        chunks.push({ value: chunk, done: false } as const);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].value.content).toContain('Name: Test');
      expect(chunks[0].value.content).toContain('Value: 42');
      expect(chunks[0].value.metadata.type).toBe('json_object');
    });

    it('should load and chunk array from JSON file', async () => {
      testFile = path.join(tempDir, 'array.json');
      const data = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Item ${i}` }));
      await fs.writeFile(testFile, JSON.stringify(data));

      const source = new JSONSource(testFile, {
        chunkSize: 3,
        toContent: (item) => `ID: ${(item as { id: number }).id}, Name: ${(item as { name: string }).name}`,
      });
      const chunks: Awaited<ReturnType<typeof source.load.next>>[] = [];

      for await (const chunk of source.load()) {
        chunks.push({ value: chunk, done: false } as const);
      }

      expect(chunks).toHaveLength(4); // 3+3+3+1
      expect(chunks[0].value.metadata.totalItems).toBe(10);
      expect(chunks[0].value.metadata.startIndex).toBe(0);
      expect(chunks[0].value.metadata.endIndex).toBe(3);
      expect(chunks[0].value.content).toContain('ID: 0, Name: Item 0');
    });

    it('should apply filter to array data', async () => {
      testFile = path.join(tempDir, 'filtered.json');
      const data = [
        { id: 1, active: true },
        { id: 2, active: false },
        { id: 3, active: true },
      ];
      await fs.writeFile(testFile, JSON.stringify(data));

      const source = new JSONSource(testFile, {
        filter: (item: unknown) => (item as { active: boolean }).active,
        toContent: (item) => `ID: ${(item as { id: number }).id}, Active: ${(item as { active: boolean }).active}`,
      });
      const chunks: Awaited<ReturnType<typeof source.load.next>>[] = [];

      for await (const chunk of source.load()) {
        chunks.push({ value: chunk, done: false } as const);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].value.content).toContain('ID: 1, Active: true');
      expect(chunks[0].value.content).toContain('ID: 3, Active: true');
      expect(chunks[0].value.metadata.totalItems).toBe(2);
    });

    it('should include custom metadata', async () => {
      testFile = path.join(tempDir, 'meta.json');
      await fs.writeFile(testFile, JSON.stringify({ test: true }));

      const source = new JSONSource(testFile, {
        namespace: 'custom-ns',
        metadata: { project: 'test', version: 1 },
        toContent: (item) => `Test: ${(item as { test: boolean }).test}`,
      });
      const chunks: Awaited<ReturnType<typeof source.load.next>>[] = [];

      for await (const chunk of source.load()) {
        chunks.push({ value: chunk, done: false } as const);
      }

      expect(chunks[0].value.id).toBe('json:custom-ns:0');
      expect(chunks[0].value.content).toBe('Test: true');
      expect(chunks[0].value.metadata.project).toBe('test');
      expect(chunks[0].value.metadata.version).toBe(1);
    });

    it('should throw on invalid JSON', async () => {
      testFile = path.join(tempDir, 'invalid.json');
      await fs.writeFile(testFile, 'not valid json');

      const source = new JSONSource(testFile, { toContent: defaultToContent });
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow('Failed to parse JSON file');
    });

    it('should throw on missing file', async () => {
      const source = new JSONSource('/nonexistent/path/file.json', { toContent: defaultToContent });
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow();
    });
  });
});
