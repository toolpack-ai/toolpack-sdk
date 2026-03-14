import { ToolParameters } from '../../../types.js';

export const name = 'coding.get_imports';
export const displayName = 'Get Imports';
export const description = 'List all import statements in a JavaScript/TypeScript file';
export const category = 'coding';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'Path to the file to analyze',
        },
    },
    required: ['file'],
};
