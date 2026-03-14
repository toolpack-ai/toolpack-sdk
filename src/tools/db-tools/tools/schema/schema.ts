import { ToolParameters } from '../../../types.js';

export const dbSchemaSchema: ToolParameters = {
    type: 'object',
    properties: {
        db: {
            type: 'string',
            description: 'Database connection URI or SQLite file path',
        },
        table: {
            type: 'string',
            description: 'Optional specific table name to inspect. If omitted, returns structural summary of all tables.',
        },
    },
    required: ['db'],
};
