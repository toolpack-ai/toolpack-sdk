import { ToolParameters } from '../../../types.js';

export const name = 'fs.write_file';
export const displayName = 'Write File';
export const description = 'Write content to a file. Creates parent directories if they do not exist. Overwrites existing files. IMPORTANT: Do NOT use this to delete/remove files - use fs.delete_file for that.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative file path to write',
        },
        content: {
            type: 'string',
            description: 'Content to write to the file',
        },
        encoding: {
            type: 'string',
            description: 'File encoding (default: utf-8)',
            default: 'utf-8',
        },
    },
    required: ['path', 'content'],
};
