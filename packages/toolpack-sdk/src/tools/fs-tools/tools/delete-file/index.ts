import * as fs from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;
    logDebug(`[fs.delete-file] execute path="${filePath}"`);

    if (!filePath) {
        throw new Error('path is required');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${filePath}. Use a different tool to remove directories.`);
    }

    fs.unlinkSync(filePath);
    return `File deleted successfully: ${filePath}`;
}

export const fsDeleteFileTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
    confirmation: {
        level: 'high',
        reason: 'This will permanently delete the file. This action cannot be undone.',
        showArgs: ['path'],
    },
};
