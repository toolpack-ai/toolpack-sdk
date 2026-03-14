import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const srcPath = args.path as string;
    const destPath = args.new_path as string;

    if (!srcPath) {
        throw new Error('path is required');
    }
    if (!destPath) {
        throw new Error('new_path is required');
    }

    if (!fs.existsSync(srcPath)) {
        throw new Error(`Source not found: ${srcPath}`);
    }

    // Create parent directories of destination if needed
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    fs.renameSync(srcPath, destPath);
    return `Moved: ${srcPath} → ${destPath}`;
}

export const fsMoveTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
