import { ToolParameters } from '../../../types.js';

export const name = 'fs.tree';
export const displayName = 'Tree';
export const description = 'Get a tree representation of a directory structure. Useful for understanding project layout at a glance.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative directory path',
        },
        depth: {
            type: 'integer',
            description: 'Maximum depth to traverse (default: 3)',
            default: 3,
        },
    },
    required: ['path'],
};
