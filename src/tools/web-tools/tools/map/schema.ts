import { ToolParameters } from '../../../types.js';

export const name = 'web.map';
export const displayName = 'Map';
export const description = 'Extract the structure/outline of a webpage by returning all headings (h1-h6). Use this FIRST when you need to understand what sections exist on a page before scraping specific content. Returns a lightweight outline showing the page hierarchy.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to map',
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
