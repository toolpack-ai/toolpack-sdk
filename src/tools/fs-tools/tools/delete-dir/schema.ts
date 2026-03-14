import { ToolParameters } from '../../../types.js';

export const name = 'fs.delete_dir';
export const displayName = 'Delete Directory';
export const description = 'Delete a directory and all its contents recursively';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative path to the directory to delete',
        },
        force: {
            type: 'boolean',
            description: 'Force deletion even if directory is not empty (default: true)',
        },
    },
    required: ['path'],
};
