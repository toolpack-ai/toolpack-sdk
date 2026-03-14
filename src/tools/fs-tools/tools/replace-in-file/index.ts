import * as fs from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;
    const search = args.search as string;
    const replace = args.replace as string;

    if (!filePath) {
        throw new Error('path is required');
    }
    if (!search) {
        throw new Error('search is required');
    }
    if (replace === undefined || replace === null) {
        throw new Error('replace is required');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Count occurrences
    let count = 0;
    let idx = 0;
    while ((idx = content.indexOf(search, idx)) !== -1) {
        count++;
        idx += search.length;
    }

    if (count === 0) {
        return `No occurrences of "${search}" found in ${filePath}`;
    }

    const newContent = content.split(search).join(replace);
    fs.writeFileSync(filePath, newContent, 'utf-8');

    return `Replaced ${count} occurrence(s) in ${filePath}`;
}

export const fsReplaceInFileTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
