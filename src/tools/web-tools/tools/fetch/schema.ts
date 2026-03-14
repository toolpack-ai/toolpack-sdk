import { ToolParameters } from '../../../types.js';

export const name = 'web.fetch';
export const displayName = 'Fetch';
export const description = 'Fetch content from a URL. Supports multiple extraction modes: full (raw HTML up to 15K chars), structured (title, excerpt, key points), or minimal (title + snippet).';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to fetch',
        },
        extractionMode: {
            type: 'string',
            description: 'Content extraction mode: "full" (raw HTML, 15K limit), "structured" (title, excerpt, key points, main content), or "minimal" (title + 500 char snippet). Default: "full"',
            enum: ['full', 'structured', 'minimal'],
            default: 'full',
        },
        headers: {
            type: 'object',
            description: 'Optional HTTP headers as key-value pairs',
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
