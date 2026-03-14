import { ToolParameters } from '../../../types.js';

export const cloudDeploySchema: ToolParameters = {
    type: 'object',
    properties: {
        siteId: {
            type: 'string',
            description: 'The Netlify Site ID to deploy to (e.g. "api_id" from Netlify UI)',
        },
        dir: {
            type: 'string',
            description: 'The local directory path to deploy (e.g. "./dist" or "./public")',
        },
        message: {
            type: 'string',
            description: 'Optional deployment message/commit note',
        }
    },
    required: ['siteId', 'dir'],
};
