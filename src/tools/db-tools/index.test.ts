import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { dbQueryTool } from './tools/query/index.js';
import { dbSchemaTool } from './tools/schema/index.js';
import { dbTablesTool } from './tools/tables/index.js';
import { dbInsertTool } from './tools/insert/index.js';
import { dbCountTool } from './tools/count/index.js';
import { DatabaseAdapterFactory } from './adapters/factory.js';
import { PostgresAdapter } from './adapters/postgres.js';
import { MysqlAdapter } from './adapters/mysql.js';
import { SQLiteAdapter } from './adapters/sqlite.js';

describe('db-tools integration', () => {
    let testDir: string;
    let dbPath: string;

    beforeAll(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-tools-test-'));
        dbPath = path.join(testDir, 'test.db');
        // create empty file so SQLite adapter can open it
        fs.writeFileSync(dbPath, '');
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('should query and manipulate sqlite', async () => {
        // 1. Create table
        await dbQueryTool.execute({
            db: dbPath,
            sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT)'
        });

        // 2. Insert rows using exact keys
        await dbInsertTool.execute({
            db: dbPath,
            table: 'users',
            data: { name: 'Alice', role: 'admin' }
        });
        await dbInsertTool.execute({
            db: dbPath,
            table: 'users',
            data: { name: 'Bob', role: 'user' }
        });

        // 3. Count rows
        const countResult = await dbCountTool.execute({
            db: dbPath,
            table: 'users'
        });
        expect(countResult as string).toContain('Rows: 2');

        // 4. Query with params
        const qResult = await dbQueryTool.execute({
            db: dbPath,
            sql: 'SELECT * FROM users WHERE role = ?',
            params: ['admin']
        });
        const parsedQuery = JSON.parse(qResult as string);
        expect(parsedQuery).toHaveLength(1);
        expect(parsedQuery[0].name).toBe('Alice');

        // 5. Query Tables list
        const tableList = await dbTablesTool.execute({ db: dbPath });
        expect(tableList as string).toContain('users');
    });
});

describe('DatabaseAdapterFactory routing', () => {
    test('routes postgres:// to PostgresAdapter', () => {
        const adapter = DatabaseAdapterFactory.getAdapter('postgres://user:pass@localhost:5432/db');
        expect(adapter).toBeInstanceOf(PostgresAdapter);
    });
    test('routes mysql:// to MysqlAdapter', () => {
        const adapter = DatabaseAdapterFactory.getAdapter('mysql://user:pass@localhost:3306/db');
        expect(adapter).toBeInstanceOf(MysqlAdapter);
    });
    test('routes sqlite:// to SQLiteAdapter', () => {
        const adapter = DatabaseAdapterFactory.getAdapter('sqlite://:memory:');
        expect(adapter).toBeInstanceOf(SQLiteAdapter);
    });
    test('routes raw path to SQLiteAdapter (default)', () => {
        const adapter = DatabaseAdapterFactory.getAdapter('./database.sqlite');
        expect(adapter).toBeInstanceOf(SQLiteAdapter);
    });
});

