import { ToolParameters } from '../../../types.js';

export const name = 'http.put';
export const displayName = 'PUT';
export const description = 'Make an HTTP PUT request to a URL with an optional body and return the response.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to request',
        },
        body: {
            type: 'string',
            description: 'Request body (JSON string or plain text)',
        },
        headers: {
            type: 'object',
            description: 'Optional HTTP headers as key-value pairs',
        },
    },
    required: ['url'],
};
