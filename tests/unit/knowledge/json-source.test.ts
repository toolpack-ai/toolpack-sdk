import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JSONSource } from '../../../src/knowledge/sources/json-source.js';

describe('JSONSource', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'json-source-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should chunk array items', async () => {
      const data = [
        { id: 1, title: 'First', description: 'First item' },
        { id: 2, title: 'Second', description: 'Second item' },
      ];
      const filePath = path.join(tempDir, 'array.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data));

      const source = new JSONSource(filePath, {
        chunkBy: 'item',
        contentFields: ['title', 'description'],
        metadataFields: ['id'],
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toContain('First');
      expect(chunks[0].metadata.id).toBe(1);
    });

    it('should use JSONPath expression', async () => {
      const data = {
        products: [
          { name: 'Widget', price: 10 },
          { name: 'Gadget', price: 20 },
        ],
      };
      const filePath = path.join(tempDir, 'nested.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data));

      const source = new JSONSource(filePath, {
        chunkBy: '$.products[*]',
        contentFields: ['name'],
        metadataFields: ['price'],
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe('Widget');
      expect(chunks[0].metadata.price).toBe(10);
    });

    it('should flatten nested objects when no contentFields specified', async () => {
      const data = {
        api: {
          auth: {
            description: 'OAuth2 flow',
          },
        },
      };
      const filePath = path.join(tempDir, 'nested-flat.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data));

      const source = new JSONSource(filePath);

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toContain('api.auth.description');
      expect(chunks[0].content).toContain('OAuth2 flow');
    });

    it('should apply namespace to chunk IDs', async () => {
      const data = [{ title: 'Test' }];
      const filePath = path.join(tempDir, 'namespaced.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data));

      const source = new JSONSource(filePath, {
        namespace: 'products',
        contentFields: ['title'],
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].id.startsWith('products:')).toBe(true);
    });

    it('should add custom metadata', async () => {
      const data = [{ title: 'Test' }];
      const filePath = path.join(tempDir, 'custom-meta.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data));

      const source = new JSONSource(filePath, {
        contentFields: ['title'],
        metadata: { type: 'product', version: 2 },
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata.type).toBe('product');
      expect(chunks[0].metadata.version).toBe(2);
    });

    it('should handle nested content fields', async () => {
      const data = [
        {
          info: {
            title: 'Nested Title',
            details: {
              summary: 'Nested summary',
            },
          },
        },
      ];
      const filePath = path.join(tempDir, 'nested-fields.json');
      await fs.promises.writeFile(filePath, JSON.stringify(data));

      const source = new JSONSource(filePath, {
        contentFields: ['info.title', 'info.details.summary'],
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toContain('Nested Title');
      expect(chunks[0].content).toContain('Nested summary');
    });
  });

  describe('error handling', () => {
    it('should throw IngestionError for invalid JSON', async () => {
      const filePath = path.join(tempDir, 'invalid.json');
      await fs.promises.writeFile(filePath, 'not valid json');

      const source = new JSONSource(filePath);

      await expect(async () => {
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow('Failed to parse JSON');
    });
  });
});
