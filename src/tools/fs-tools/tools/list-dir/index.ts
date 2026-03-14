import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

interface FileEntry {
    name: string;
    type: 'file' | 'directory';
    size: number;
}

function listDir(dirPath: string, recursive: boolean, entries: FileEntry[], prefix: string = ''): void {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        const relativeName = prefix ? `${prefix}/${item.name}` : item.name;

        if (item.isDirectory()) {
            entries.push({ name: relativeName, type: 'directory', size: 0 });
            if (recursive) {
                listDir(fullPath, true, entries, relativeName);
            }
        } else if (item.isFile()) {
            const stat = fs.statSync(fullPath);
            entries.push({ name: relativeName, type: 'file', size: stat.size });
        }
    }
}

async function execute(args: Record<string, any>): Promise<string> {
    const dirPath = args.path as string;
    const recursive = (args.recursive === true) as boolean;

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

    const entries: FileEntry[] = [];
    listDir(dirPath, recursive, entries);

    return JSON.stringify(entries, null, 2);
}

export const fsListDirTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
