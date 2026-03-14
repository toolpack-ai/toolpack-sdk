import { ToolParameters } from '../../../types.js';

export const gitBlameSchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Path to the file to blame.',
        },
    },
    required: ['path'],
};
