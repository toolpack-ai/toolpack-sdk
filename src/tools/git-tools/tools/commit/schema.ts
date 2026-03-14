import { ToolParameters } from '../../../types.js';

export const gitCommitSchema: ToolParameters = {
    type: 'object',
    properties: {
        message: {
            type: 'string',
            description: 'The commit message.',
        },
    },
    required: ['message'],
};
