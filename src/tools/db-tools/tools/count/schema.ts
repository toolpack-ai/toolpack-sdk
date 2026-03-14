import { ToolParameters } from '../../../types.js';

export const dbCountSchema: ToolParameters = {
    type: 'object',
    properties: {
        db: {
            type: 'string',
            description: 'Database connection URI or SQLite file path',
        },
        table: {
            type: 'string',
            description: 'Name of the table to count rows from',
        },
        where: {
            type: 'string',
            description: 'Optional WHERE clause condition',
        },
    },
    required: ['db', 'table'],
};
