import { ToolParameters } from '../../../types.js';

export const dbDeleteSchema: ToolParameters = {
    type: 'object',
    properties: {
        db: {
            type: 'string',
            description: 'Database connection URI or SQLite file path',
        },
        table: {
            type: 'string',
            description: 'Name of the table to delete from',
        },
        where: {
            type: 'string',
            description: 'WHERE clause condition (e.g. "id = 5"). DO NOT INCLUDE the word WHERE.',
        },
    },
    required: ['db', 'table', 'where'],
};
