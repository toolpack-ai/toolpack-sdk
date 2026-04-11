import { describe, it, expect } from 'vitest';
import { SQLiteSource } from '../sources/sqlite.js';

const defaultToContent = (row: Record<string, unknown>) =>
  Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(', ');

describe('SQLiteSource', () => {
  describe('constructor', () => {
    it('should throw if toContent is not provided', () => {
      expect(() => {
        new SQLiteSource('/path/to/db.sqlite', {} as { toContent: (row: Record<string, unknown>) => string });
      }).toThrow('SQLiteSource requires a toContent callback');
    });

    it('should create with database path and toContent', () => {
      const source = new SQLiteSource('/path/to/db.sqlite', {
        toContent: defaultToContent,
      });
      expect(source).toBeDefined();
    });

    it('should create with options', () => {
      const source = new SQLiteSource('/path/to/db.sqlite', {
        namespace: 'myapp',
        query: 'SELECT * FROM users',
        chunkSize: 50,
        metadata: { version: 1 },
        toContent: defaultToContent,
      });
      expect(source).toBeDefined();
    });
  });

  describe('load', () => {
    it('should throw if better-sqlite3 is not installed', async () => {
      const source = new SQLiteSource('/path/to/db.sqlite', {
        toContent: defaultToContent,
      });

      // This will fail if better-sqlite3 is not installed
      // The error should be about the package not being found
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow();
    });

    it('should throw on non-existent database file', async () => {
      const source = new SQLiteSource('/nonexistent/path/db.sqlite', {
        toContent: defaultToContent,
      });

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow('SQLite database file not found');
    });
  });

  describe('loadCSV', () => {
    it('should validate preLoadCSV config structure', () => {
      const source = new SQLiteSource('/path/to/db.sqlite', {
        toContent: defaultToContent,
        preLoadCSV: {
          tableName: 'users',
          csvPath: '/path/to/data.csv',
        },
      });
      expect(source).toBeDefined();
    });

    it('should accept CSV with custom delimiter', () => {
      const source = new SQLiteSource('/path/to/db.sqlite', {
        toContent: defaultToContent,
        preLoadCSV: {
          tableName: 'users',
          csvPath: '/path/to/data.tsv',
          delimiter: '\t',
          headers: true,
        },
      });
      expect(source).toBeDefined();
    });
  });
});
