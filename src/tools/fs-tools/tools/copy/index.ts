import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

function copyRecursive(src: string, dest: string): void {
    const stat = fs.statSync(src);

    if (stat.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        const items = fs.readdirSync(src);
        for (const item of items) {
            copyRecursive(path.join(src, item), path.join(dest, item));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

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

    copyRecursive(srcPath, destPath);

    const stat = fs.statSync(srcPath);
    const type = stat.isDirectory() ? 'directory' : 'file';
    return `Copied ${type}: ${srcPath} → ${destPath}`;
}

export const fsCopyTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
