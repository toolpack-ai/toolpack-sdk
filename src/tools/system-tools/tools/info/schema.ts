import { ToolParameters } from '../../../types.js';

export const name = 'system.info';
export const displayName = 'Info';
export const description = 'Get system information including OS, CPU, memory, and architecture.';
export const category = 'system';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {},
};
