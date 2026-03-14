import { ToolParameters } from '../../../types.js';

export const name = 'coding.refactor_rename';
export const displayName = 'Refactor Rename';
export const description = 'Rename a symbol across the entire codebase intelligently';
export const category = 'coding';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        symbol: {
            type: 'string',
            description: 'Current name of the symbol to rename',
        },
        newName: {
            type: 'string',
            description: 'New name for the symbol',
        },
        path: {
            type: 'string',
            description: 'Directory path to search and rename in',
        },
        dryRun: {
            type: 'boolean',
            description: 'Preview changes without applying them (default: false)',
        },
    },
    required: ['symbol', 'newName', 'path'],
};
