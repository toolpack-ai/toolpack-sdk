import { ToolParameters } from '../../../types.js';

export const gitLogSchema: ToolParameters = {
    type: 'object',
    properties: {
        maxCount: {
            type: 'number',
            description: 'Maximum number of commits to return. Defaults to 10 to prevent large outputs.',
            default: 10,
        },
        path: {
            type: 'string',
            description: 'Optional path to get the log for specific file or directory.',
        },
    },
};
