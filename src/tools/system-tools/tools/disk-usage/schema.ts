import { ToolParameters } from '../../../types.js';

export const name = 'system.disk_usage';
export const displayName = 'Disk Usage';
export const description = 'Get disk usage information for a given path or the root filesystem.';
export const category = 'system';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Path to check disk usage for (default: /)',
            default: '/',
        },
    },
};
