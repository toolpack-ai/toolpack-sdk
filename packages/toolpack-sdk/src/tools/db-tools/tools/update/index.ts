import { ToolDefinition } from '../../../types.js';
import { dbUpdateSchema } from './schema.js';
import { DatabaseAdapterFactory } from '../../adapters/factory.js';

export const dbUpdateTool: ToolDefinition = {
    name: 'db.update',
    displayName: 'Database Update',
    description: 'Update existing rows in a database table.',
    category: 'database',
    parameters: dbUpdateSchema,
    execute: async (args: Record<string, unknown>) => {
        const dbPath = args.db as string;
        const table = args.table as string;
        const data = args.data as Record<string, unknown>;
        const where = args.where as string;

        if (Object.keys(data).length === 0) {
            return 'Error: No data provided to update.';
        }

        try {
            const setClause = Object.keys(data).map(col => `${col} = ?`).join(', ');
            const params = Object.values(data);

            const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
            const adapter = DatabaseAdapterFactory.getAdapter(dbPath);
            const result = await adapter.execute(sql, params);

            return JSON.stringify(result, null, 2);
        } catch (error: unknown) {
            return `Database update error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
    confirmation: {
        level: 'high',
        reason: 'This will update database rows, potentially affecting multiple records.',
        showArgs: ['table', 'data', 'where'],
    },
};
