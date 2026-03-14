import { ToolParameters } from '../../../types.js';

export const diffApplySchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Path to the file to patch.',
        },
        patch: {
            type: 'string',
            description: 'Unified diff string to apply.',
        },
    },
    required: ['path', 'patch'],
};
