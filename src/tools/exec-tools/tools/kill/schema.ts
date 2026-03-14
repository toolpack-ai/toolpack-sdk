import { ToolParameters } from '../../../types.js';

export const name = 'exec.kill';
export const displayName = 'Kill';
export const description = 'Kill a background process started with exec.run_background.';
export const category = 'execution';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        process_id: {
            type: 'string',
            description: 'The process ID returned by exec.run_background',
        },
    },
    required: ['process_id'],
};
