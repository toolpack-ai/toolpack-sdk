import mysql from 'mysql2/promise';
import { DatabaseAdapter, DatabaseExecuteResult } from './base.js';

export class MysqlAdapter extends DatabaseAdapter {
    private async getConnection(): Promise<mysql.Connection> {
        return await mysql.createConnection(this.connectionString);
    }

    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        const connection = await this.getConnection();
        try {
            const [rows] = await connection.execute(sql, params as any[]);
            return rows as T[];
        } finally {
            await connection.end();
        }
    }

    async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecuteResult> {
        const connection = await this.getConnection();
        try {
            const [result] = await connection.execute(sql, params as any[]) as any;
            return {
                changes: result.affectedRows,
                lastInsertRowid: result.insertId,
                raw: result
            };
        } finally {
            await connection.end();
        }
    }

    async getTables(): Promise<string[]> {
        const sql = "SHOW TABLES";
        const result = await this.query<any>(sql);
        if (!result || result.length === 0) return [];

        // SHOW TABLES returns dynamic column names based on db name
        // E.g. { "Tables_in_mydb": "users" }
        const keys = Object.keys(result[0] as object);
        return result.map((row: any) => row[keys[0]]);
    }

    async getSchema(table?: string): Promise<any> {
        if (table) {
            const connection = await this.getConnection();
            try {
                // connection.query supports ?? for identifiers whereas connection.execute does not
                const [rows] = await connection.query("DESCRIBE ??", [table]);
                return rows;
            } finally {
                await connection.end();
            }
        } else {
            return await this.query("SHOW TABLES");
        }
    }
}
