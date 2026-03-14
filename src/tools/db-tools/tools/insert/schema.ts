import { ToolParameters } from '../../../types.js';

export const dbInsertSchema: ToolParameters = {
    type: 'object',
    properties: {
        db: {
            type: 'string',
            description: 'Database connection URI or SQLite file path',
        },
        table: {
            type: 'string',
            description: 'Name of the table to insert into',
        },
        data: {
            type: 'object',
            description: 'Key-value pairs of column names and values to insert'
        },
    },
    required: ['db', 'table', 'data'],
};
