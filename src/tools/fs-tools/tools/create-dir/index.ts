import * as fs from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const dirPath = args.path as string;
    const recursive = args.recursive !== false;

    if (!dirPath) {
        throw new Error('path is required');
    }

    if (fs.existsSync(dirPath)) {
        const stat = fs.statSync(dirPath);
        if (stat.isDirectory()) {
            return `Directory already exists: ${dirPath}`;
        }
        throw new Error(`Path exists but is not a directory: ${dirPath}`);
    }

    fs.mkdirSync(dirPath, { recursive });
    return `Directory created: ${dirPath}`;
}

export const fsCreateDirTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
