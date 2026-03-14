import { ToolParameters, ToolParameterProperty } from '../../../types.js';

export const dbQuerySchema: ToolParameters = {
    type: 'object',
    properties: {
        db: {
            type: 'string',
            description: 'Database connection URI (e.g. postgres://user:pass@host/db, mysql://...) or local SQLite file path (.sqlite, .db)',
        },
        sql: {
            type: 'string',
            description: 'The SQL query to execute',
        },
        params: {
            type: 'array',
            description: 'Optional array of parameters for parameterized queries (to prevent SQL injection)',
            items: {} as ToolParameterProperty,
            default: []
        },
    },
    required: ['db', 'sql'],
};
