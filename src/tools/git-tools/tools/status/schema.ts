import { ToolParameters } from '../../../types.js';

export const gitStatusSchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Optional path or directory to check the status for. If omitted, checks the entire repository.',
        },
    },
};
