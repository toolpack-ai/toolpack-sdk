import { ToolDefinition } from '../../../types.js';
import { dbDeleteSchema } from './schema.js';
import { DatabaseAdapterFactory } from '../../adapters/factory.js';

export const dbDeleteTool: ToolDefinition = {
    name: 'db.delete',
    displayName: 'Database Delete',
    description: 'Delete rows from a database table.',
    category: 'database',
    parameters: dbDeleteSchema,
    execute: async (args: Record<string, unknown>) => {
        const dbPath = args.db as string;
        const table = args.table as string;
        const where = args.where as string;

        try {
            const sql = `DELETE FROM ${table} WHERE ${where}`;
            const adapter = DatabaseAdapterFactory.getAdapter(dbPath);
            const result = await adapter.execute(sql);

            return JSON.stringify(result, null, 2);
        } catch (error: unknown) {
            return `Database delete error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
    confirmation: {
        level: 'high',
        reason: 'This will permanently delete rows from the database.',
        showArgs: ['table', 'where'],
    },
};
