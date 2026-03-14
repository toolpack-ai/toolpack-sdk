import { ToolParameters } from '../../../types.js';

export const name = 'coding.get_exports';
export const displayName = 'Get File Exports';
export const description = 'Lists all symbols exported by a file.';
export const category = 'coding';

export interface GetExportsArgs {
    file: string;
}

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'The absolute path to the file'
        }
    },
    required: ['file'],
};
