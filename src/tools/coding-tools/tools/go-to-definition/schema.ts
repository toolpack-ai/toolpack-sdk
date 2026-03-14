import { ToolParameters } from '../../../types.js';

export const name = 'coding.go_to_definition';
export const displayName = 'Go To Definition';
export const description = 'Jump to the definition of a symbol at a specific location in a file';
export const category = 'coding';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'Path to the file containing the symbol reference',
        },
        line: {
            type: 'integer',
            description: 'Line number where the symbol is referenced (1-indexed)',
        },
        column: {
            type: 'integer',
            description: 'Column number where the symbol is referenced (0-indexed)',
        },
        searchPath: {
            type: 'string',
            description: 'Optional: directory to search for the definition (defaults to file directory)',
        },
    },
    required: ['file', 'line', 'column'],
};
