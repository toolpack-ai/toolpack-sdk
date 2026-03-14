import { ToolParameters } from '../../../types.js';

export const name = 'web.extract_links';
export const displayName = 'Extract Links';
export const description = 'Extract all links from a webpage. Returns an array of objects with text and URL. Optionally filter by pattern.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to extract links from',
        },
        filter: {
            type: 'string',
            description: 'Optional filter: "same-domain" to only include links from the same domain, or a substring to match against URLs',
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
