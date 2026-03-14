import * as fs from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;

    if (!filePath) {
        throw new Error('path is required');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`Path not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    return JSON.stringify({
        path: filePath,
        type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
        size: stat.size,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        accessed: stat.atime.toISOString(),
        permissions: stat.mode.toString(8),
    });
}

export const fsStatTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
