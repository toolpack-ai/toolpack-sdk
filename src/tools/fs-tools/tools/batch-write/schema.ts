import { ToolParameters } from '../../../types.js';

export const name = 'fs.batch_write';
export const displayName = 'Batch Write Files';
export const description = 'Write multiple files atomically in one operation. If atomic mode is enabled, all writes succeed or all are rolled back on failure.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        files: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                },
            },
            description: 'Array of files to write, each with path and content',
        },
        encoding: {
            type: 'string',
            description: 'File encoding (default: utf-8)',
        },
        atomic: {
            type: 'boolean',
            description: 'Atomic mode: rollback all writes if any fails (default: true)',
        },
        createDirs: {
            type: 'boolean',
            description: 'Create parent directories if they don\'t exist (default: true)',
        },
    },
    required: ['files'],
};
