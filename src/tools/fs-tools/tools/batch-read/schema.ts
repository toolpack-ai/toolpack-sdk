import { ToolParameters } from '../../../types.js';

export const name = 'fs.batch_read';
export const displayName = 'Batch Read Files';
export const description = 'Read multiple files efficiently in one operation. Returns content for each file or error if read fails.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of file paths to read',
        },
        encoding: {
            type: 'string',
            description: 'File encoding (default: utf-8)',
        },
        continueOnError: {
            type: 'boolean',
            description: 'Continue reading other files if one fails (default: true)',
        },
    },
    required: ['paths'],
};
