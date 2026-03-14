import { ToolParameters } from '../../../types.js';

export const name = 'fs.search';
export const displayName = 'Search';
export const description = 'Search for text in files within a directory. Returns matching lines with file paths and line numbers.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Directory path to search in',
        },
        query: {
            type: 'string',
            description: 'Text or pattern to search for',
        },
        recursive: {
            type: 'boolean',
            description: 'Search recursively in subdirectories (default: true)',
            default: true,
        },
        max_results: {
            type: 'integer',
            description: 'Maximum number of matching lines to return (default: 50)',
            default: 50,
        },
        regex: {
            type: 'boolean',
            description: 'Treat query as a regular expression (default: false)',
            default: false,
        },
        case_sensitive: {
            type: 'boolean',
            description: 'Perform case-sensitive search. If false, search is case-insensitive (default: false)',
            default: false,
        },
    },
    required: ['path', 'query'],
};
