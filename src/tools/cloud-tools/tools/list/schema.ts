import { ToolParameters } from '../../../types.js';

export const cloudListSchema: ToolParameters = {
    type: 'object',
    properties: {
        siteId: {
            type: 'string',
            description: 'The Netlify Site ID',
        },
        limit: {
            type: 'number',
            description: 'Number of recent deployments to return. Defaults to 5.',
            default: 5
        },
    },
    required: ['siteId'],
};
