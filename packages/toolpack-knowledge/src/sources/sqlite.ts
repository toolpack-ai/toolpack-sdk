import * as fs from 'fs/promises';
import * as path from 'path';
import { KnowledgeSource, Chunk } from '../interfaces.js';
import { IngestionError } from '../errors.js';

export interface SQLiteSourceOptions {
  namespace?: string;
  metadata?: Record<string, unknown>;
  query?: string;
  chunkSize?: number;
  /** Required. Transform each database row into a human-readable string for AI embedding. */
  toContent: (row: Record<string, unknown>) => string;
  preLoadCSV?: {
    tableName: string;
    csvPath: string;
    delimiter?: string;
    headers?: boolean;
  };
}

/**
 * Knowledge source for SQLite databases.
 * Supports SQL queries and optional CSV/TSV pre-loading.
 * Note: This requires the 'better-sqlite3' package to be installed.
 */
export class SQLiteSource implements KnowledgeSource {
  private options: Required<Pick<SQLiteSourceOptions, 'namespace' | 'metadata' | 'chunkSize' | 'toContent'>> &
    Pick<SQLiteSourceOptions, 'query' | 'preLoadCSV'>;

  constructor(
    private dbPath: string,
    options: SQLiteSourceOptions
  ) {
    if (!options.toContent) {
      throw new IngestionError(
        'SQLiteSource requires a toContent callback. Example: toContent: (row) => `Name: ${row.name}`',
        this.dbPath
      );
    }
    this.options = {
      namespace: options.namespace ?? 'sqlite',
      metadata: options.metadata ?? {},
      chunkSize: options.chunkSize ?? 100,
      toContent: options.toContent,
      query: options.query,
      preLoadCSV: options.preLoadCSV,
    };
  }

  async *load(): AsyncIterable<Chunk> {
    let Database: new (path: string) => { exec: (sql: string) => void; prepare: (sql: string) => { all: () => unknown[] } };
    
    try {
      // Dynamic import to avoid hard dependency
      const sqlite3 = await import('better-sqlite3');
      Database = sqlite3.default;
    } catch {
      throw new IngestionError(
        'SQLite source requires "better-sqlite3" package. Install with: npm install better-sqlite3',
        this.dbPath
      );
    }

    // Check if database file exists
    try {
      await fs.access(this.dbPath);
    } catch {
      throw new IngestionError('SQLite database file not found', this.dbPath);
    }

    const db = new Database(this.dbPath);

    try {
      // Pre-load CSV if specified
      if (this.options.preLoadCSV) {
        await this.loadCSV(db, this.options.preLoadCSV);
      }

      // Execute query and yield results
      const query = this.options.query ?? 'SELECT * FROM sqlite_master WHERE type = "table"';
      const stmt = db.prepare(query);
      const rows = stmt.all();

      // Transform each row using toContent and chunk
      const contentItems = rows.map((row) => this.options.toContent(row as Record<string, unknown>));
      
      for (let i = 0; i < contentItems.length; i += this.options.chunkSize) {
        const chunkItems = contentItems.slice(i, i + this.options.chunkSize);
        const chunkContent = chunkItems.join('\n\n---\n\n');
        
        yield {
          id: `sqlite:${this.options.namespace}:${i}`,
          content: chunkContent,
          metadata: {
            ...this.options.metadata,
            source: path.basename(this.dbPath),
            type: 'sqlite_query_result',
            query,
            startIndex: i,
            endIndex: Math.min(i + this.options.chunkSize, contentItems.length),
            totalRows: contentItems.length,
          },
        };
      }
    } finally {
      db.exec('VACUUM;');
      // Note: better-sqlite3 closes automatically when garbage collected
    }
  }

  private async loadCSV(
    db: { exec: (sql: string) => void },
    config: NonNullable<SQLiteSourceOptions['preLoadCSV']>
  ): Promise<void> {
    const fs = await import('fs');
    const csvContent = await fs.promises.readFile(config.csvPath, 'utf-8');
    
    const delimiter = config.delimiter ?? ',';
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return;
    }

    let headers: string[];
    let dataStartIndex: number;

    if (config.headers !== false) {
      headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
      dataStartIndex = 1;
    } else {
      // Generate column names if no headers
      const firstRow = lines[0].split(delimiter);
      headers = firstRow.map((_, i) => `col${i}`);
      dataStartIndex = 0;
    }

    // Create table with sanitized table name (alphanumeric and underscore only)
    const sanitizedTableName = config.tableName.replace(/[^a-zA-Z0-9_]/g, '_');
    const columns = headers.map(h => `"${h.replace(/"/g, '""')}" TEXT`).join(', ');
    db.exec(`DROP TABLE IF EXISTS "${sanitizedTableName}";`);
    db.exec(`CREATE TABLE "${sanitizedTableName}" (${columns});`);

    // Insert data using prepared statement (type assertion needed for better-sqlite3 API)
    const placeholders = headers.map(() => '?').join(', ');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertStmt = (db as any).prepare(`INSERT INTO "${sanitizedTableName}" VALUES (${placeholders})`);
    for (let i = dataStartIndex; i < lines.length; i++) {
      const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
      insertStmt.run(values);
    }
  }
}
