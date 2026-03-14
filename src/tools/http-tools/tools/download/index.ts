import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const filePath = args.path as string;
    const headers = args.headers as Record<string, string> | undefined;

    if (!url) {
        throw new Error('url is required');
    }
    if (!filePath) {
        throw new Error('path is required');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('url must start with http:// or https://');
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: headers || {},
    });

    if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Create parent directories if needed
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, buffer);
    return `Downloaded ${url} → ${filePath} (${buffer.length} bytes)`;
}

export const httpDownloadTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
