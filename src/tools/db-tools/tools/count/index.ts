import { ToolDefinition } from '../../../types.js';
import { dbCountSchema } from './schema.js';
import { DatabaseAdapterFactory } from '../../adapters/factory.js';

export const dbCountTool: ToolDefinition = {
    name: 'db.count',
    displayName: 'Database Count',
    description: 'Count rows in a database table.',
    category: 'database',
    parameters: dbCountSchema,
    execute: async (args: Record<string, unknown>) => {
        const dbPath = args.db as string;
        const table = args.table as string;
        const where = args.where as string | undefined;

        try {
            const whereClause = where ? `WHERE ${where}` : '';
            const sql = `SELECT COUNT(*) as count FROM ${table} ${whereClause}`;
            const adapter = DatabaseAdapterFactory.getAdapter(dbPath);
            const result = await adapter.query<any>(sql);

            // Postgres node-pg might return count as string if bigint
            if (Array.isArray(result) && result.length > 0) {
                return `Rows: ${result[0].count}`;
            }
            return 'Count: 0';
        } catch (error: unknown) {
            return `Database count error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
