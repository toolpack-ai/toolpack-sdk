import { ToolParameters } from '../../../types.js';

export const name = 'fs.append_file';
export const displayName = 'Append File';
export const description = 'Append content to the end of a file. Creates the file if it does not exist.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative file path to append to',
        },
        content: {
            type: 'string',
            description: 'Content to append to the file',
        },
        encoding: {
            type: 'string',
            description: 'File encoding (default: utf-8)',
            default: 'utf-8',
        },
    },
    required: ['path', 'content'],
};
