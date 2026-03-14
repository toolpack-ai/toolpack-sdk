import { ToolParameters } from '../../../types.js';

export const name = 'coding.multi_file_edit';
export const displayName = 'Multi-File Edit';
export const description = 'Edit multiple files atomically with rollback on failure';
export const category = 'coding';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        edits: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    changes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                oldText: { type: 'string' },
                                newText: { type: 'string' },
                            },
                        },
                    },
                },
            },
            description: 'Array of file edits, each with file path and array of text replacements',
        },
        atomic: {
            type: 'boolean',
            description: 'Atomic mode: rollback all edits if any fails (default: true)',
        },
    },
    required: ['edits'],
};
