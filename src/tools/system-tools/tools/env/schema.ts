import { ToolParameters } from '../../../types.js';

export const name = 'system.env';
export const displayName = 'Environment';
export const description = 'Get environment variable(s). If key is provided, returns that specific variable. Otherwise returns all environment variables.';
export const category = 'system';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        key: {
            type: 'string',
            description: 'Specific environment variable name to get (optional, returns all if omitted)',
        },
    },
};
