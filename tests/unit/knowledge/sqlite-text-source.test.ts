import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { SQLiteTextSource } from '../../../src/knowledge/sources/sqlite-text-source.js';

describe('SQLiteTextSource', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sqlite-source-test-'));
    dbPath = path.join(tempDir, 'test.db');

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY,
        title TEXT,
        body TEXT,
        author TEXT,
        created_at TEXT
      )
    `);
    db.prepare(`
      INSERT INTO articles (title, body, author, created_at) VALUES
      ('First Article', 'This is the first article body.', 'Alice', '2024-01-01'),
      ('Second Article', 'This is the second article body.', 'Bob', '2024-01-02'),
      ('Third Article', 'This is the third article body.', 'Alice', '2024-01-03')
    `).run();
    db.close();
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should load rows as chunks', async () => {
      const source = new SQLiteTextSource(dbPath, {
        table: 'articles',
        contentColumns: ['title', 'body'],
        metadataColumns: ['id', 'author'],
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0].content).toContain('First Article');
      expect(chunks[0].content).toContain('first article body');
      expect(chunks[0].metadata.author).toBe('Alice');
    });

    it('should concatenate content columns', async () => {
      const source = new SQLiteTextSource(dbPath, {
        table: 'articles',
        contentColumns: ['title', 'body'],
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toContain('First Article');
      expect(chunks[0].content).toContain('first article body');
    });

    it('should apply WHERE clause', async () => {
      const source = new SQLiteTextSource(dbPath, {
        table: 'articles',
        contentColumns: ['title', 'body'],
        where: "author = 'Alice'",
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
    });

    it('should apply namespace to chunk IDs', async () => {
      const source = new SQLiteTextSource(dbPath, {
        table: 'articles',
        contentColumns: ['title'],
        namespace: 'blog',
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].id.startsWith('blog:')).toBe(true);
    });

    it('should add custom metadata', async () => {
      const source = new SQLiteTextSource(dbPath, {
        table: 'articles',
        contentColumns: ['title'],
        metadata: { type: 'blog-post' },
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata.type).toBe('blog-post');
      expect(chunks[0].metadata.table).toBe('articles');
    });

    it('should include source path in metadata', async () => {
      const source = new SQLiteTextSource(dbPath, {
        table: 'articles',
        contentColumns: ['title'],
      });

      const chunks: any[] = [];
      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata.source).toBe(dbPath);
    });
  });

  describe('error handling', () => {
    it('should throw IngestionError for non-existent table', async () => {
      const source = new SQLiteTextSource(dbPath, {
        table: 'nonexistent',
        contentColumns: ['title'],
      });

      await expect(async () => {
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow('Failed to read SQLite');
    });

    it('should throw IngestionError for non-existent database', async () => {
      const source = new SQLiteTextSource('/nonexistent/path.db', {
        table: 'articles',
        contentColumns: ['title'],
      });

      await expect(async () => {
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow('Failed to read SQLite');
    });
  });
});
