import { ToolParameters } from '../../../types.js';

export const name = 'fs.list_dir';
export const displayName = 'List Directory';
export const description = 'List files and directories at the given path. Optionally recurse into subdirectories.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative directory path to list',
        },
        recursive: {
            type: 'boolean',
            description: 'Whether to list recursively (default: false)',
            default: false,
        },
    },
    required: ['path'],
};
