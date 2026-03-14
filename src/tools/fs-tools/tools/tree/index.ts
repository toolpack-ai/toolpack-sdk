import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

function buildTree(dirPath: string, prefix: string, depth: number, maxDepth: number, lines: string[]): void {
    if (depth > maxDepth) return;

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const sorted = items.sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const isLast = i === sorted.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        if (item.isDirectory()) {
            lines.push(`${prefix}${connector}${item.name}/`);
            buildTree(path.join(dirPath, item.name), prefix + childPrefix, depth + 1, maxDepth, lines);
        } else {
            lines.push(`${prefix}${connector}${item.name}`);
        }
    }
}

async function execute(args: Record<string, any>): Promise<string> {
    const dirPath = args.path as string;
    const maxDepth = (args.depth || 3) as number;

    if (!dirPath) {
        throw new Error('path is required');
    }

    if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory not found: ${dirPath}`);
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
    }

    const dirName = path.basename(dirPath);
    const lines: string[] = [`${dirName}/`];
    buildTree(dirPath, '', 1, maxDepth, lines);

    return lines.join('\n');
}

export const fsTreeTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
