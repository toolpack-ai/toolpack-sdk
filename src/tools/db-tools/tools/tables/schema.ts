import { ToolParameters } from '../../../types.js';

export const dbTablesSchema: ToolParameters = {
    type: 'object',
    properties: {
        db: {
            type: 'string',
            description: 'Database connection URI or SQLite file path',
        },
    },
    required: ['db'],
};
