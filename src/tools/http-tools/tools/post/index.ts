import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

const MAX_RESPONSE_LENGTH = 100_000;

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const body = args.body as string | undefined;
    const headers = (args.headers || {}) as Record<string, string>;

    if (!url) {
        throw new Error('url is required');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('url must start with http:// or https://');
    }

    // Auto-detect content type if not set
    if (body && !headers['Content-Type'] && !headers['content-type']) {
        try {
            JSON.parse(body);
            headers['Content-Type'] = 'application/json';
        } catch {
            headers['Content-Type'] = 'text/plain';
        }
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: body || undefined,
    });

    const responseBody = await response.text();
    const status = `HTTP ${response.status} ${response.statusText}`;

    if (responseBody.length > MAX_RESPONSE_LENGTH) {
        return `${status}\n${responseBody.substring(0, MAX_RESPONSE_LENGTH)}\n\n... (truncated, total ${responseBody.length} characters)`;
    }

    return `${status}\n${responseBody}`;
}

export const httpPostTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
