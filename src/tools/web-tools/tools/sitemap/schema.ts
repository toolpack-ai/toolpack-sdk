import { ToolParameters } from '../../../types.js';

export const name = 'web.sitemap';
export const displayName = 'Extract Sitemap';
export const description = 'Parse sitemap.xml or robots.txt to discover all pages on a site. Returns an array of URLs with lastmod/priority if available.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The base URL or direct sitemap.xml / robots.txt URL',
        },
        max_urls: {
            type: 'integer',
            description: 'Maximum number of URLs to return (default: 100)',
            default: 100,
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
