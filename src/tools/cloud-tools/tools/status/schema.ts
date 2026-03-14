import { ToolParameters } from '../../../types.js';

export const cloudStatusSchema: ToolParameters = {
    type: 'object',
    properties: {
        siteId: {
            type: 'string',
            description: 'The Netlify Site ID',
        },
        deployId: {
            type: 'string',
            description: 'The specific Deployment ID to check',
        },
    },
    required: ['siteId', 'deployId'],
};
