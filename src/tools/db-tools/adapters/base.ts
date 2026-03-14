export interface DatabaseExecuteResult {
    changes?: number;
    lastInsertRowid?: number | bigint | string;
    raw?: any;
}

export abstract class DatabaseAdapter {
    protected connectionString: string;

    constructor(connectionString: string) {
        this.connectionString = connectionString;
    }

    /**
     * Run a read-only query (SELECT)
     */
    abstract query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;

    /**
     * Run a write query (INSERT, UPDATE, DELETE)
     */
    abstract execute(sql: string, params?: unknown[]): Promise<DatabaseExecuteResult>;

    /**
     * Introspect database tables
     */
    abstract getTables(): Promise<string[]>;

    /**
     * Introspect table schemas
     */
    abstract getSchema(table?: string): Promise<any>;
}
