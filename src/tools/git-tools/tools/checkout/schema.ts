import { ToolParameters } from '../../../types.js';

export const gitCheckoutSchema: ToolParameters = {
    type: 'object',
    properties: {
        branch: {
            type: 'string',
            description: 'Name of the branch or commit to checkout.',
        },
    },
    required: ['branch'],
};
