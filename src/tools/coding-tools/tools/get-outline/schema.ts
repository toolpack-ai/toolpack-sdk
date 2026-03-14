import { ToolParameters } from '../../../types.js';

export const name = 'coding.get_outline';
export const displayName = 'Get File Outline';
export const description = 'Gets a hierarchical outline of symbols (classes, functions, methods) in a specified file.';
export const category = 'coding';

export interface GetOutlineArgs {
    file: string;
}

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'The absolute path to the file to outline'
        }
    },
    required: ['file'],
};
