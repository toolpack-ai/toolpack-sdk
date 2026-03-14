import { ToolParameters } from '../../../types.js';

export const name = 'fs.exists';
export const displayName = 'Exists';
export const description = 'Check if a file or directory exists at the given path. Returns true or false.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative path to check',
        },
    },
    required: ['path'],
};
