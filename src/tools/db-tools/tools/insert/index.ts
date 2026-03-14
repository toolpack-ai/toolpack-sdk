import { ToolDefinition } from '../../../types.js';
import { dbInsertSchema } from './schema.js';
import { DatabaseAdapterFactory } from '../../adapters/factory.js';

export const dbInsertTool: ToolDefinition = {
    name: 'db.insert',
    displayName: 'Database Insert',
    description: 'Insert a new row into an SQLite table safely.',
    category: 'database',
    parameters: dbInsertSchema,
    execute: async (args: Record<string, unknown>) => {
        const dbPath = args.db as string;
        const table = args.table as string;
        const data = args.data as Record<string, unknown>;

        if (Object.keys(data).length === 0) {
            return 'Error: No data provided to insert.';
        }

        try {
            const columns = Object.keys(data).join(', ');
            const placeholders = Object.keys(data).map(() => '?').join(', ');
            const params = Object.values(data);

            const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
            const adapter = DatabaseAdapterFactory.getAdapter(dbPath);
            const result = await adapter.execute(sql, params);

            return JSON.stringify(result, null, 2);
        } catch (error: unknown) {
            return `Database insert error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
