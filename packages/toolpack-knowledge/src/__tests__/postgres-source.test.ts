import { describe, it, expect, vi } from 'vitest';
import { PostgresSource } from '../sources/postgres.js';

const defaultToContent = (row: Record<string, unknown>) =>
  Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(', ');

describe('PostgresSource', () => {
  describe('constructor', () => {
    it('should create with connection string and toContent', () => {
      const source = new PostgresSource({
        query: 'SELECT * FROM users',
        connectionString: 'postgresql://user:pass@localhost/db',
        toContent: defaultToContent,
      });
      expect(source).toBeDefined();
    });

    it('should create with individual config options and toContent', () => {
      const source = new PostgresSource({
        query: 'SELECT * FROM users',
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        user: 'admin',
        password: 'secret',
        toContent: defaultToContent,
      });
      expect(source).toBeDefined();
    });

    it('should throw without query', () => {
      expect(() => {
        new PostgresSource({ toContent: defaultToContent } as { query: string; toContent: (row: Record<string, unknown>) => string });
      }).toThrow('PostgresSource requires a query');
    });

    it('should throw without toContent', () => {
      expect(() => {
        new PostgresSource({ query: 'SELECT 1' } as { query: string; toContent: (row: Record<string, unknown>) => string });
      }).toThrow('PostgresSource requires a toContent callback');
    });

    it('should use default values', () => {
      const source = new PostgresSource({
        query: 'SELECT 1',
        database: 'test',
        user: 'test',
        password: 'test',
        toContent: defaultToContent,
      });
      expect(source).toBeDefined();
    });
  });

  describe('load', () => {
    it('should throw if pg package is not installed', async () => {
      // Mock the import to throw
      vi.doMock('pg', () => {
        throw new Error('Module not found');
      });

      const source = new PostgresSource({
        query: 'SELECT * FROM test',
        connectionString: 'postgresql://localhost/test',
        toContent: defaultToContent,
      });

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of source.load()) {
          // consume
        }
      }).rejects.toThrow('requires "pg" package');

      vi.doUnmock('pg');
    });
  });
});
