import { ToolParameters } from '../../../types.js';

export const name = 'system.cwd';
export const displayName = 'Current Directory';
export const description = 'Get the current working directory of the process.';
export const category = 'system';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {},
};
