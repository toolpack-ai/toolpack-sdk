import { ToolParameters } from '../../../types.js';

export const gitDiffSchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Optional path to get the diff for. If omitted, gets the diff for the entire repository.',
        },
        staged: {
            type: 'boolean',
            description: 'If true, gets the diff of staged changes instead of unstaged changes.',
            default: false,
        },
    },
};
