import { ToolParameters } from '../../../types.js';

export const name = 'fs.replace_in_file';
export const displayName = 'Replace In File';
export const description = 'Find and replace text in a file. Returns the number of replacements made.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative file path',
        },
        search: {
            type: 'string',
            description: 'Text to search for',
        },
        replace: {
            type: 'string',
            description: 'Text to replace with',
        },
    },
    required: ['path', 'search', 'replace'],
};
