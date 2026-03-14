import { ToolParameters } from '../../../types.js';

export const name = 'http.download';
export const displayName = 'Download';
export const description = 'Download a file from a URL and save it to a local path.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to download from',
        },
        path: {
            type: 'string',
            description: 'Local file path to save the downloaded file',
        },
        headers: {
            type: 'object',
            description: 'Optional HTTP headers as key-value pairs',
        },
    },
    required: ['url', 'path'],
};
