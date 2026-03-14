import { ToolParameters } from '../../../types.js';

export const name = 'coding.extract_function';
export const displayName = 'Extract Function';
export const description = 'Extracts a selected code region into a new function, automatically detecting required parameters and return values.';
export const category = 'coding';

export interface ExtractFunctionArgs {
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    newFunctionName: string;
}

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'The absolute path to the file'
        },
        startLine: {
            type: 'number',
            description: '1-indexed start line of the code to extract'
        },
        startColumn: {
            type: 'number',
            description: '0-indexed start column of the code to extract'
        },
        endLine: {
            type: 'number',
            description: '1-indexed end line of the code to extract'
        },
        endColumn: {
            type: 'number',
            description: '0-indexed end column of the code to extract'
        },
        newFunctionName: {
            type: 'string',
            description: 'The name for the newly extracted function'
        }
    },
    required: ['file', 'startLine', 'startColumn', 'endLine', 'endColumn', 'newFunctionName'],
};
