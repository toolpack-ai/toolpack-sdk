import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import type { KnowledgeSource, Chunk, ChunkUpdate, SQLiteTextSourceOptions } from '../types.js';
import { IngestionError } from '../errors.js';

const DEFAULT_POLL_INTERVAL = 5000;

export class SQLiteTextSource implements KnowledgeSource {
  private dbPath: string;
  private options: SQLiteTextSourceOptions;
  private db: Database.Database | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastRowHashes: Map<string, string> = new Map();

  constructor(dbPath: string, options: SQLiteTextSourceOptions) {
    this.dbPath = path.resolve(dbPath);
    this.options = {
      pollInterval: DEFAULT_POLL_INTERVAL,
      ...options,
    };
  }

  async *load(): AsyncIterable<Chunk> {
    try {
      this.db = new Database(this.dbPath, { readonly: true });
      const rows = this.fetchRows();

      for (const row of rows) {
        const chunk = this.rowToChunk(row);
        this.lastRowHashes.set(chunk.id, this.hashContent(chunk.content));
        yield chunk;
      }
    } catch (error) {
      throw new IngestionError(
        `Failed to read SQLite database: ${(error as Error).message}`,
        this.dbPath,
        error as Error
      );
    } finally {
      this.closeDb();
    }
  }

  async *watch(): AsyncIterable<ChunkUpdate> {
    if (!this.options.watch) {
      return;
    }

    const updateQueue: ChunkUpdate[] = [];
    let resolveNext: ((value: ChunkUpdate) => void) | null = null;

    const poll = () => {
      try {
        this.db = new Database(this.dbPath, { readonly: true });
        const rows = this.fetchRows();
        const currentIds = new Set<string>();

        for (const row of rows) {
          const chunk = this.rowToChunk(row);
          currentIds.add(chunk.id);
          const newHash = this.hashContent(chunk.content);
          const oldHash = this.lastRowHashes.get(chunk.id);

          if (!oldHash) {
            this.lastRowHashes.set(chunk.id, newHash);
            updateQueue.push({ type: 'add', chunk });
          } else if (oldHash !== newHash) {
            this.lastRowHashes.set(chunk.id, newHash);
            updateQueue.push({ type: 'update', chunk });
          }
        }

        for (const [id] of this.lastRowHashes) {
          if (!currentIds.has(id)) {
            this.lastRowHashes.delete(id);
            updateQueue.push({
              type: 'delete',
              chunk: { id, content: '', metadata: {} },
            });
          }
        }

        this.closeDb();

        if (resolveNext && updateQueue.length > 0) {
          const update = updateQueue.shift()!;
          const resolve = resolveNext;
          resolveNext = null;
          resolve(update);
        }
      } catch {
        // Database might be locked
      }
    };

    this.pollTimer = setInterval(poll, this.options.pollInterval);

    while (true) {
      if (updateQueue.length > 0) {
        yield updateQueue.shift()!;
      } else {
        yield await new Promise<ChunkUpdate>((resolve) => {
          resolveNext = resolve;
        });
      }
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.closeDb();
  }

  private fetchRows(): any[] {
    if (!this.db) {
      throw new Error('Database not open');
    }

    const columns = [
      ...this.options.contentColumns,
      ...(this.options.metadataColumns ?? []),
    ];

    let query = `SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${this.options.table}"`;

    if (this.options.where) {
      query += ` WHERE ${this.options.where}`;
    }

    return this.db.prepare(query).all();
  }

  private rowToChunk(row: any): Chunk {
    const contentParts = this.options.contentColumns
      .map((col) => row[col])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v));

    const content = contentParts.join('\n\n');

    const metadata: Record<string, any> = {
      ...(this.options.metadata ?? {}),
      source: this.dbPath,
      table: this.options.table,
    };

    if (this.options.metadataColumns) {
      for (const col of this.options.metadataColumns) {
        if (row[col] !== undefined) {
          metadata[col] = row[col];
        }
      }
    }

    const namespace = this.options.namespace ?? 'sqlite';
    const primaryKey = this.getPrimaryKeyValue(row);
    const id = `${namespace}:${this.options.table}:${primaryKey}`;

    return { id, content, metadata };
  }

  private getPrimaryKeyValue(row: any): string {
    if (this.options.metadataColumns?.includes('id')) {
      return String(row.id);
    }
    if (row.id !== undefined) {
      return String(row.id);
    }
    if (row.rowid !== undefined) {
      return String(row.rowid);
    }
    const hash = this.hashContent(JSON.stringify(row));
    return hash.slice(0, 8);
  }

  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private closeDb(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
