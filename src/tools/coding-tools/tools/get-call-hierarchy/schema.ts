import { ToolParameters } from '../../../types.js';

export const name = 'coding.get_call_hierarchy';
export const displayName = 'Get Call Hierarchy';
export const description = 'Shows callers and callees of a specific function or method.';
export const category = 'coding';

export interface GetCallHierarchyArgs {
    file: string;
    line: number;
    column: number;
}

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        file: {
            type: 'string',
            description: 'The absolute path to the file containing the function'
        },
        line: {
            type: 'number',
            description: '1-indexed line number where the function is defined or called'
        },
        column: {
            type: 'number',
            description: '0-indexed column number where the function is defined or called'
        }
    },
    required: ['file', 'line', 'column'],
};
