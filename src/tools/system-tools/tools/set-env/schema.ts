import { ToolParameters } from '../../../types.js';

export const name = 'system.set_env';
export const displayName = 'Set Environment';
export const description = 'Set an environment variable for the current session. Does not persist across restarts.';
export const category = 'system';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        key: {
            type: 'string',
            description: 'Environment variable name',
        },
        value: {
            type: 'string',
            description: 'Value to set',
        },
    },
    required: ['key', 'value'],
};
