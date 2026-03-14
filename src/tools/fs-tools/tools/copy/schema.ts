import { ToolParameters } from '../../../types.js';

export const name = 'fs.copy';
export const displayName = 'Copy';
export const description = 'Copy a file or directory from one path to another. Recursively copies directories.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Source path (file or directory)',
        },
        new_path: {
            type: 'string',
            description: 'Destination path',
        },
    },
    required: ['path', 'new_path'],
};
