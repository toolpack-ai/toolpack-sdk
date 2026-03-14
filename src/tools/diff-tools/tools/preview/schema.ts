import { ToolParameters } from '../../../types.js';

export const diffPreviewSchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Path to the file to apply the patch against for preview.',
        },
        patch: {
            type: 'string',
            description: 'Unified diff string to preview.',
        },
    },
    required: ['path', 'patch'],
};
