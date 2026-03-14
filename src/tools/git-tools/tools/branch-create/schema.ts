import { ToolParameters } from '../../../types.js';

export const gitBranchCreateSchema: ToolParameters = {
    type: 'object',
    properties: {
        name: {
            type: 'string',
            description: 'Name of the new branch.',
        },
        checkout: {
            type: 'boolean',
            description: 'Whether to checkout the new branch after creating it.',
            default: false,
        },
        startPoint: {
            type: 'string',
            description: 'Optional start point (commit hash or branch name) for the new branch.',
        },
    },
    required: ['name'],
};
