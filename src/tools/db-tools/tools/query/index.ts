import { ToolDefinition } from '../../../types.js';
import { dbQuerySchema } from './schema.js';
import { DatabaseAdapterFactory } from '../../adapters/factory.js';
import { logDebug } from '../../../../providers/provider-logger.js';

export const dbQueryTool: ToolDefinition = {
    name: 'db.query',
    displayName: 'Database Query',
    description: 'Execute raw SQL queries against an SQLite, PostgreSQL, or MySQL database.',
    category: 'database',
    parameters: dbQuerySchema,
    execute: async (args: Record<string, unknown>) => {
        const dbPath = args.db as string;
        const sql = args.sql as string;
        const params = (args.params as unknown[]) || [];
        logDebug(`[db.query] execute db="${dbPath}" sql="${sql.substring(0, 80)}..." params=${params.length}`);

        try {
            // Note: Use execute for mutating queries or query for read-only.
            // If the user wants to get rows, they use query string.
            // If we use adapter.query, all drivers support returning rows
            const adapter = DatabaseAdapterFactory.getAdapter(dbPath);
            const result = await adapter.query(sql, params);
            return JSON.stringify(result, null, 2);
        } catch (error: unknown) {
            return `Database query error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
