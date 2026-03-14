import { ToolParameters } from '../../../types.js';

export const name = 'fs.move';
export const displayName = 'Move';
export const description = 'Move or rename a file or directory from one path to another.';
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
