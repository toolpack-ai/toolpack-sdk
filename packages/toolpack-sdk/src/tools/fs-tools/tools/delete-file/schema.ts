import { ToolParameters } from '../../../types.js';

export const name = 'fs.delete_file';
export const displayName = 'Delete File';
export const description = 'Remove/delete a file from the filesystem. Does not delete directories.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative file path to delete',
        },
    },
    required: ['path'],
};
