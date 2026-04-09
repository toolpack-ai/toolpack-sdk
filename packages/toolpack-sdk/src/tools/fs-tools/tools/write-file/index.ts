import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;
    const content = args.content as string;
    const encoding = (args.encoding || 'utf-8') as BufferEncoding;
    logDebug(`[fs.write-file] execute path="${filePath}" encoding=${encoding} content_len=${content?.length ?? 0}`);

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
    confirmation: {
        level: 'high',
        reason: 'This will overwrite the entire file contents.',
        showArgs: ['path'],
    },
};
