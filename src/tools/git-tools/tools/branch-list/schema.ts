import { ToolParameters } from '../../../types.js';

export const gitBranchListSchema: ToolParameters = {
    type: 'object',
    properties: {
        remote: {
            type: 'boolean',
            description: 'List remote branches as well.',
            default: false,
        },
    },
};
