import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KnowledgeProvider, Chunk, QueryOptions, QueryResult } from '../interfaces.js';
import { DimensionMismatchError, KnowledgeProviderError } from '../errors.js';
import { cosineSimilarity, matchesFilter } from '../utils/cosine.js';
import { keywordSearch } from '../utils/keyword.js';

export interface PersistentKnowledgeProviderOptions {
  namespace: string;
  storagePath?: string;
  reSync?: boolean;
}

export class PersistentKnowledgeProvider implements KnowledgeProvider {
  private db: Database.Database;
  private dimensions?: number;
  private dbPath: string;

  constructor(private options: PersistentKnowledgeProviderOptions) {
    const basePath = options.storagePath || path.join(os.homedir(), '.toolpack', 'knowledge');
    this.dbPath = path.join(basePath, `${options.namespace}.db`);
    
    fs.mkdirSync(basePath, { recursive: true });
    
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    
    this.initSchema();
    this.loadDimensions();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id        TEXT PRIMARY KEY,
        content   TEXT NOT NULL,
        metadata  TEXT NOT NULL,
        vector    BLOB NOT NULL,
        synced_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        id, content, metadata
      );

      CREATE TABLE IF NOT EXISTS provider_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks
      BEGIN
        INSERT INTO chunks_fts (id, content, metadata) VALUES (new.id, new.content, new.metadata);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks
      BEGIN
        DELETE FROM chunks_fts WHERE id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks
      BEGIN
        UPDATE chunks_fts SET content = new.content, metadata = new.metadata WHERE id = new.id;
      END;
    `);
  }

  private loadDimensions(): void {
    const row = this.db.prepare('SELECT value FROM provider_meta WHERE key = ?').get('dimensions') as { value: string } | undefined;
    if (row) {
      this.dimensions = parseInt(row.value, 10);
    }
  }

  async validateDimensions(dimensions: number): Promise<void> {
    if (this.dimensions && this.dimensions !== dimensions) {
      throw new DimensionMismatchError(this.dimensions, dimensions);
    }
    
    if (!this.dimensions) {
      this.db.prepare('INSERT OR REPLACE INTO provider_meta (key, value) VALUES (?, ?)').run('dimensions', dimensions.toString());
      this.dimensions = dimensions;
    }
  }

  async add(chunks: Chunk[]): Promise<void> {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, content, metadata, vector, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((chunks: Chunk[]) => {
      for (const chunk of chunks) {
        if (!chunk.vector) {
          throw new KnowledgeProviderError('Chunk missing vector');
        }
        
        const vectorBlob = Buffer.from(new Float32Array(chunk.vector).buffer);
        insert.run(
          chunk.id,
          chunk.content,
          JSON.stringify(chunk.metadata),
          vectorBlob,
          Date.now()
        );
      }
    });

    transaction(chunks);
  }

  async query(queryVector: number[], options: QueryOptions = {}): Promise<QueryResult[]> {
    const {
      limit = 10,
      threshold = 0.7,
      filter,
      includeMetadata = true,
      includeVectors = false,
    } = options;

    const rows = this.db.prepare('SELECT id, content, metadata, vector FROM chunks').all() as Array<{
      id: string;
      content: string;
      metadata: string;
      vector: Buffer;
    }>;

    const results: QueryResult[] = [];

    for (const row of rows) {
      const metadata = JSON.parse(row.metadata);
      
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
      const vectorArray = Array.from(vector);
      const score = cosineSimilarity(queryVector, vectorArray);
      
      if (score >= threshold) {
        results.push({
          chunk: {
            id: row.id,
            content: row.content,
            metadata: includeMetadata ? metadata : {},
            vector: includeVectors ? vectorArray : undefined,
          },
          score,
          distance: 1 - score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  }

  async keywordQuery(query: string, options: QueryOptions = {}): Promise<QueryResult[]> {
    const {
      limit = 10,
      threshold = 0.1,
      filter,
      includeMetadata = true,
      includeVectors = false,
    } = options;

    // Use FTS for efficient keyword search
    const ftsQuery = query.split(/\s+/).map(term => `"${term}"`).join(' OR ');
    const rows = this.db.prepare(`
      SELECT c.id, c.content, c.metadata, c.vector, highlight(chunks_fts, 1, '<mark>', '</mark>') as highlighted
      FROM chunks_fts fts
      JOIN chunks c ON fts.id = c.id
      WHERE chunks_fts MATCH ?
      ORDER BY bm25(chunks_fts) DESC
      LIMIT ?
    `).all(ftsQuery, limit * 2) as Array<{
      id: string;
      content: string;
      metadata: string;
      vector: Buffer;
      highlighted: string;
    }>;

    const results: QueryResult[] = [];

    for (const row of rows) {
      const metadata = JSON.parse(row.metadata);

      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Use keywordSearch for scoring since FTS doesn't give scores directly
      const score = keywordSearch(row.content, query);

      if (score >= threshold) {
        const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);

        results.push({
          chunk: {
            id: row.id,
            content: row.content,
            metadata: includeMetadata ? metadata : {},
            vector: includeVectors ? Array.from(vector) : undefined,
          },
          score,
          distance: 1 - score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  async delete(ids: string[]): Promise<void> {
    const del = this.db.prepare('DELETE FROM chunks WHERE id = ?');
    const transaction = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        del.run(id);
      }
    });
    transaction(ids);
  }

  async clear(): Promise<void> {
    this.db.prepare('DELETE FROM chunks').run();
    this.db.prepare('DELETE FROM provider_meta WHERE key = ?').run('dimensions');
    this.dimensions = undefined;
  }

  async getAllChunks(): Promise<Chunk[]> {
    const rows = this.db.prepare('SELECT id, content, metadata, vector FROM chunks').all() as Array<{
      id: string;
      content: string;
      metadata: string;
      vector: Buffer;
    }>;

    return rows.map(row => {
      const metadata = JSON.parse(row.metadata);
      const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);

      return {
        id: row.id,
        content: row.content,
        metadata,
        vector: Array.from(vector),
      };
    });
  }

  shouldReSync(): boolean {
    if (this.options.reSync === false) {
      const count = this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
      return count.count === 0;
    }
    return true;
  }

  close(): void {
    this.db.close();
  }
}
