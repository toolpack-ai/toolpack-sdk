import { ToolParameters } from '../../../types.js';

export const name = 'web.screenshot';
export const displayName = 'Screenshot';
export const description = 'Render a page with headless browser and return screenshot Base64 PNG or rendered HTML.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to capture',
        },
        format: {
            type: 'string',
            description: 'Output format: "html" or "png" (default: "html")',
            enum: ['html', 'png'],
            default: 'html',
        },
        viewport: {
            type: 'object',
            description: 'Optional viewport { width, height } (default: { width: 1280, height: 800 })',
            properties: {
                width: { type: 'integer' },
                height: { type: 'integer' }
            }
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
