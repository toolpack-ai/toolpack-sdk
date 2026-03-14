import { ToolParameters } from '../../../types.js';

export const name = 'exec.list_processes';
export const displayName = 'List Processes';
export const description = 'List all managed background processes started with exec.run_background, including their status.';
export const category = 'execution';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {},
};
