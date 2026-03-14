import { ToolParameters } from '../../../types.js';

export const name = 'http.delete';
export const displayName = 'DELETE';
export const description = 'Make an HTTP DELETE request to a URL and return the response.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to request',
        },
        headers: {
            type: 'object',
            description: 'Optional HTTP headers as key-value pairs',
        },
    },
    required: ['url'],
};
