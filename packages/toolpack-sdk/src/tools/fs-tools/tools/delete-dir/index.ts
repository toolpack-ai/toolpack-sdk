import { rm } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const path = args.path as string;
    const force = args.force !== false;

    if (!path) {
        throw new Error('path is required');
    }

    if (!existsSync(path)) {
        throw new Error(`Directory does not exist: ${path}`);
    }

    const stats = statSync(path);
    if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${path}`);
    }

    try {
        await rm(path, { recursive: true, force });
        return `Directory deleted successfully: ${path}`;
    } catch (error: any) {
        throw new Error(`Failed to delete directory "${path}": ${error.message}`);
    }
}

export const fsDeleteDirTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
    confirmation: {
        level: 'high',
        reason: 'This will recursively delete the directory and all its contents. This action cannot be undone.',
        showArgs: ['path'],
    },
};
