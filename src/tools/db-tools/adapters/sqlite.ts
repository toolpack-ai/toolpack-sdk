import Database from 'better-sqlite3';
import * as fs from 'fs';
import { DatabaseAdapter, DatabaseExecuteResult } from './base.js';

export class SQLiteAdapter extends DatabaseAdapter {
    private getDb(): Database.Database {
        if (!fs.existsSync(this.connectionString)) {
            throw new Error(`Database file not found: ${this.connectionString}`);
        }
        return new Database(this.connectionString, { readonly: false });
    }

    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        const db = this.getDb();
        try {
            const stmt = db.prepare(sql);
            if (stmt.reader) {
                return stmt.all(params) as T[];
            } else {
                // If it's a write operation accidentally called via query, we return empty array or run it
                stmt.run(params);
                return [];
            }
        } finally {
            db.close();
        }
    }

    async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecuteResult> {
        const db = this.getDb();
        try {
            const stmt = db.prepare(sql);
            const result = stmt.run(params);
            return {
                changes: result.changes,
                lastInsertRowid: result.lastInsertRowid,
                raw: result
            };
        } finally {
            db.close();
        }
    }

    async getTables(): Promise<string[]> {
        const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
        const result = await this.query<{ name: string }>(sql);
        return result.map(row => row.name);
    }

    async getSchema(table?: string): Promise<any> {
        if (table) {
            return await this.query(`PRAGMA table_info("${table}")`);
        } else {
            return await this.query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        }
    }

    // Original static method kept for backwards compatibility during refactor if needed, 
    // but tools will be updated to use the factory.
    static executeSession<T = unknown>(dbPath: string, sql: string, params: unknown[] = []): T[] | { changes: number; lastInsertRowid: number | bigint } {
        if (!fs.existsSync(dbPath)) {
            throw new Error(`Database file not found: ${dbPath}`);
        }
        const db = new Database(dbPath, { readonly: false });
        try {
            const stmt = db.prepare(sql);
            if (stmt.reader) {
                return stmt.all(params) as T[];
            } else {
                return stmt.run(params);
            }
        } finally {
            db.close();
        }
    }
}
