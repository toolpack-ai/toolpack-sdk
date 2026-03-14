import { ToolParameters } from '../../../types.js';

export const name = 'coding.get_diagnostics';
export const displayName = 'Get File Diagnostics';
export const description = 'Gets syntax errors and warnings for a file utilizing AST parsing.';
export const category = 'coding';

export interface GetDiagnosticsArgs {
    file: string;
}

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'The absolute path to the file to check for diagnostics'
        }
    },
    required: ['file'],
};
