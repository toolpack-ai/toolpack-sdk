import { ToolParameters } from '../../../types.js';

export const name = 'coding.get_symbols';
export const displayName = 'Get Symbols';
export const description = 'List all symbols (functions, classes, variables, etc.) in a JavaScript/TypeScript file';
export const category = 'coding';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'Path to the file to analyze',
        },
        kind: {
            type: 'string',
            description: 'Optional: filter by symbol kind (function, class, variable, const, let, interface, type)',
        },
    },
    required: ['file'],
};
