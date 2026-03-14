import { ToolDefinition } from '../../../types.js';
import { dbTablesSchema } from './schema.js';
import { DatabaseAdapterFactory } from '../../adapters/factory.js';

export const dbTablesTool: ToolDefinition = {
    name: 'db.tables',
    displayName: 'Database Tables',
    description: 'List all user tables in the database.',
    category: 'database',
    parameters: dbTablesSchema,
    execute: async (args: Record<string, unknown>) => {
        const dbPath = args.db as string;

        try {
            const adapter = DatabaseAdapterFactory.getAdapter(dbPath);
            const tables = await adapter.getTables();
            return JSON.stringify(tables, null, 2);
        } catch (error: unknown) {
            return `Database tables error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
