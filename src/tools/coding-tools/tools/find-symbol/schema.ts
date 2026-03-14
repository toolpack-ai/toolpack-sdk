import { ToolParameters } from '../../../types.js';

export const name = 'coding.find_symbol';
export const displayName = 'Find Symbol';
export const description = 'Find function, class, or variable definitions in JavaScript/TypeScript files using AST parsing';
export const category = 'coding';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        symbol: {
            type: 'string',
            description: 'Name of the symbol to find (function, class, variable, etc.)',
        },
        path: {
            type: 'string',
            description: 'File or directory path to search in (searches recursively if directory)',
        },
        kind: {
            type: 'string',
            description: 'Optional: filter by symbol kind (function, class, variable, const, let, interface, type)',
        },
    },
    required: ['symbol', 'path'],
};
