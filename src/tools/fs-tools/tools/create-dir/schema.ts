import { ToolParameters } from '../../../types.js';

export const name = 'fs.create_dir';
export const displayName = 'Create Directory';
export const description = 'Create a directory at the given path. Creates parent directories recursively if they do not exist.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative directory path to create',
        },
        recursive: {
            type: 'boolean',
            description: 'Create parent directories if they do not exist (default: true)',
            default: true,
        },
    },
    required: ['path'],
};
