import { ToolParameters } from '../../../types.js';

export const name = 'web.feed';
export const displayName = 'Extract Feed';
export const description = 'Parse RSS/Atom feeds and return structured entries. Requires rss-parser library to be installed.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL of the RSS/Atom feed',
        },
        max_entries: {
            type: 'integer',
            description: 'Maximum number of entries to return (default: 10)',
            default: 10,
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
