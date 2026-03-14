import { ToolParameters } from '../../../types.js';

export const name = 'web.scrape';
export const displayName = 'Scrape';
export const description = 'Extract clean text content from a webpage. RECOMMENDED WORKFLOW: Use web.map first to see page structure, then use section parameter to extract specific sections. Strips scripts, styles, navigation, and other junk. By default, auto-detects and extracts the main article/content area.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to scrape',
        },
        section: {
            type: 'string',
            description: 'Optional section name to extract (e.g., "talks", "about", "experience"). Finds the heading containing this text and extracts content until the next same-level heading. Use web.map first to discover available sections.',
        },
        format: {
            type: 'string',
            description: 'Output format: "text" (clean readable text) or "tables" (extract table data as JSON array). Default: "text"',
            enum: ['text', 'tables'],
            default: 'text',
        },
        selector: {
            type: 'string',
            description: 'Optional CSS selector to target a specific element. Only use if you know the exact selector exists.',
        },
        max_length: {
            type: 'integer',
            description: 'Maximum characters to return (default: 6000). Keep small (3000-6000) to avoid context limits.',
            default: 6000,
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['url'],
};
