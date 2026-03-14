import { ToolParameters } from '../../../types.js';

export const name = 'coding.find_references';
export const displayName = 'Find References';
export const description = 'Find all references to a symbol across JavaScript/TypeScript files';
export const category = 'coding';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        symbol: {
            type: 'string',
            description: 'Name of the symbol to find references for',
        },
        path: {
            type: 'string',
            description: 'File or directory path to search in (searches recursively if directory)',
        },
        includeDeclaration: {
            type: 'boolean',
            description: 'Include the symbol declaration in results (default: false)',
        },
    },
    required: ['symbol', 'path'],
};
