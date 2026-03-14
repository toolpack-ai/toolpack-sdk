import { ToolParameters } from '../../../types.js';

export const name = 'fs.stat';
export const displayName = 'Stat';
export const description = 'Get file or directory information including size, type, and modification date.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative path to get info for',
        },
    },
    required: ['path'],
};
