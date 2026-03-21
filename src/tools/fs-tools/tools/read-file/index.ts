import * as fs from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;
    const encoding = (args.encoding || 'utf-8') as BufferEncoding;
    logDebug(`[fs.read-file] execute path="${filePath}" encoding=${encoding}`);

    if (!filePath) {
        throw new Error('path is required');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, encoding);
    return content;
}

export const fsReadFileTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
