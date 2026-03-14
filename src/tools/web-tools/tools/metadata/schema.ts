import { ToolParameters } from '../../../types.js';

export const name = 'web.metadata';
export const displayName = 'Extract Metadata';
export const description = 'Extract Open Graph, Twitter Cards, JSON-LD, and meta tags from a URL.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to extract metadata from',
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
