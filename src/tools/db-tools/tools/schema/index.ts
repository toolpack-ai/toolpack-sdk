import { ToolDefinition } from '../../../types.js';
import { dbSchemaSchema } from './schema.js';
import { DatabaseAdapterFactory } from '../../adapters/factory.js';

export const dbSchemaTool: ToolDefinition = {
    name: 'db.schema',
    displayName: 'Database Schema',
    description: 'Get the structural schema of a database or a specific table.',
    category: 'database',
    parameters: dbSchemaSchema,
    execute: async (args: Record<string, unknown>) => {
        const dbPath = args.db as string;
        const table = args.table as string | undefined;

        try {
            const adapter = DatabaseAdapterFactory.getAdapter(dbPath);
            const result = await adapter.getSchema(table);
            return JSON.stringify(result, null, 2);
        } catch (error: unknown) {
            return `Database schema error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
