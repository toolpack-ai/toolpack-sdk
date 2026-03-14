import { ToolParameters } from '../../../types.js';

export const diffCreateSchema: ToolParameters = {
    type: 'object',
    properties: {
        oldContent: {
            type: 'string',
            description: 'The original text content.',
        },
        newContent: {
            type: 'string',
            description: 'The new text content.',
        },
        fileName: {
            type: 'string',
            description: 'Optional filename to include in the patch header.',
        },
        contextLines: {
            type: 'number',
            description: 'Number of context lines to include around differences. Default is 4.',
            default: 4,
        }
    },
    required: ['oldContent', 'newContent'],
};
