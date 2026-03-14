import { ToolParameters } from '../../../types.js';

export const gitAddSchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: "Path to the file or directory to stage. To stage all changes, use '.'.",
        },
    },
    required: ['path'],
};
