import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;
    const content = args.content as string;
    const encoding = (args.encoding || 'utf-8') as BufferEncoding;

    if (!filePath) {
        throw new Error('path is required');
    }
    if (content === undefined || content === null) {
        throw new Error('content is required');
    }

    // Create parent directories if they don't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, encoding);
    return `File written successfully: ${filePath} (${Buffer.byteLength(content, encoding)} bytes)`;
}

export const fsWriteFileTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
