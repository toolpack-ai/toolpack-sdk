import { KnowledgeSource, Chunk } from '../interfaces.js';
import { IngestionError } from '../errors.js';

export interface PostgresSourceOptions {
  namespace?: string;
  metadata?: Record<string, unknown>;
  query: string;
  chunkSize?: number;
  /** Required. Transform each database row into a human-readable string for AI embedding. */
  toContent: (row: Record<string, unknown>) => string;
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

/**
 * Knowledge source for PostgreSQL databases.
 * Supports SQL queries with optional chunking.
 * Note: This requires the 'pg' package to be installed.
 */
export class PostgresSource implements KnowledgeSource {
  private options: Required<Pick<PostgresSourceOptions, 'namespace' | 'metadata' | 'chunkSize' | 'toContent'>> &
    Pick<PostgresSourceOptions, 'query' | 'connectionString' | 'host' | 'port' | 'database' | 'user' | 'password' | 'ssl'>;

  constructor(options: PostgresSourceOptions) {
    if (!options.query) {
      throw new IngestionError('PostgresSource requires a query', 'config');
    }
    if (!options.toContent) {
      throw new IngestionError(
        'PostgresSource requires a toContent callback. Example: toContent: (row) => `Name: ${row.name}`',
        'config'
      );
    }

    this.options = {
      namespace: options.namespace ?? 'postgres',
      metadata: options.metadata ?? {},
      chunkSize: options.chunkSize ?? 100,
      toContent: options.toContent,
      query: options.query,
      connectionString: options.connectionString,
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      ssl: options.ssl,
    };
  }

  async *load(): AsyncIterable<Chunk> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Client: any;
    
    try {
      // Dynamic import to avoid hard dependency
      const pg = await import('pg');
      Client = pg.Client;
    } catch {
      throw new IngestionError(
        'PostgreSQL source requires "pg" package. Install with: npm install pg',
        'config'
      );
    }

    // Build connection config
    const clientConfig = this.options.connectionString
      ? { connectionString: this.options.connectionString }
      : {
          host: this.options.host ?? 'localhost',
          port: this.options.port ?? 5432,
          database: this.options.database,
          user: this.options.user,
          password: this.options.password,
          ssl: this.options.ssl,
        };

    const client = new Client(clientConfig);

    try {
      await client.connect();

      // Execute query
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await client.query(this.options.query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = result.rows as Array<Record<string, unknown>>;

      // Transform each row using toContent and chunk
      const contentItems = rows.map((row) => this.options.toContent(row));
      
      for (let i = 0; i < contentItems.length; i += this.options.chunkSize) {
        const chunkItems = contentItems.slice(i, i + this.options.chunkSize);
        const chunkContent = chunkItems.join('\n\n---\n\n');
        
        yield {
          id: `postgres:${this.options.namespace}:${i}`,
          content: chunkContent,
          metadata: {
            ...this.options.metadata,
            type: 'postgres_query_result',
            query: this.options.query,
            startIndex: i,
            endIndex: Math.min(i + this.options.chunkSize, contentItems.length),
            totalRows: contentItems.length,
          },
        };
      }
    } finally {
      await client.end();
    }
  }
}
