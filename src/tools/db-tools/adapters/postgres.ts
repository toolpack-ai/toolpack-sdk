import pg from 'pg';
import { DatabaseAdapter, DatabaseExecuteResult } from './base.js';

export class PostgresAdapter extends DatabaseAdapter {
    private async getClient(): Promise<pg.Client> {
        const client = new pg.Client({ connectionString: this.connectionString });
        await client.connect();
        return client;
    }

    /**
     * PostgreSQL expects 1-based indexed parameters $1, $2, etc.
     * Our tools pass in ? placeholders. We dynamically convert them.
     */
    private convertSql(sql: string): string {
        let count = 1;
        return sql.replace(/\?/g, () => `$${count++}`);
    }

    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        const client = await this.getClient();
        try {
            const pgSql = this.convertSql(sql);
            const res = await client.query(pgSql, params);
            return res.rows as T[];
        } finally {
            await client.end();
        }
    }

    async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecuteResult> {
        const client = await this.getClient();
        try {
            const pgSql = this.convertSql(sql);
            const res = await client.query(pgSql, params);
            return {
                changes: res.rowCount ?? 0,
                // Postgres does not return last inserted ID without RETURNING clause
                raw: res
            };
        } finally {
            await client.end();
        }
    }

    async getTables(): Promise<string[]> {
        const sql = "SELECT tablename as name FROM pg_catalog.pg_tables WHERE schemaname != 'pg_catalog' AND schemaname != 'information_schema'";
        const result = await this.query<{ name: string }>(sql);
        return result.map(row => row.name);
    }

    async getSchema(table?: string): Promise<any> {
        if (table) {
            const sql = `
                SELECT column_name, data_type, is_nullable, column_default 
                FROM information_schema.columns 
                WHERE table_name = $1
            `;
            return await this.query(sql, [table]);
        } else {
            const sql = `
                SELECT table_name as name, table_type 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
            `;
            return await this.query(sql);
        }
    }
}
