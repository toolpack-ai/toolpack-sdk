import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

const MAX_RESPONSE_LENGTH = 100_000;

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const headers = args.headers as Record<string, string> | undefined;

    if (!url) {
        throw new Error('url is required');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('url must start with http:// or https://');
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: headers || {},
    });

    const body = await response.text();
    const status = `HTTP ${response.status} ${response.statusText}`;

    if (!response.ok) {
        return `${status}\n${body}`;
    }

    if (body.length > MAX_RESPONSE_LENGTH) {
        return `${status}\n${body.substring(0, MAX_RESPONSE_LENGTH)}\n\n... (truncated, total ${body.length} characters)`;
    }

    return `${status}\n${body}`;
}

export const httpGetTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
