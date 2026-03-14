import { ToolParameters } from '../../../types.js';

export const name = 'fs.read_file';
export const displayName = 'Read File';
export const description = 'Read the contents of a file at the given path. Returns the file content as a string.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative file path to read',
        },
        encoding: {
            type: 'string',
            description: 'File encoding (default: utf-8)',
            default: 'utf-8',
        },
    },
    required: ['path'],
};
