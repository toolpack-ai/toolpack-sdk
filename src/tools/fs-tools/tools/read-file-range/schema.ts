import { ToolParameters } from '../../../types.js';

export const name = 'fs.read_file_range';
export const displayName = 'Read File Range';
export const description = 'Read a specific range of lines from a file. Useful for reading portions of large files without loading the entire content.';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative file path to read',
        },
        start_line: {
            type: 'integer',
            description: 'Start line number (1-indexed)',
        },
        end_line: {
            type: 'integer',
            description: 'End line number (1-indexed, inclusive)',
        },
    },
    required: ['path', 'start_line', 'end_line'],
};
