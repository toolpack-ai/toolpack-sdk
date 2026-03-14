import * as fs from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;
    const startLine = args.start_line as number;
    const endLine = args.end_line as number;

    if (!filePath) {
        throw new Error('path is required');
    }
    if (startLine === undefined || startLine === null) {
        throw new Error('start_line is required');
    }
    if (endLine === undefined || endLine === null) {
        throw new Error('end_line is required');
    }
    if (startLine < 1) {
        throw new Error('start_line must be >= 1');
    }
    if (endLine < startLine) {
        throw new Error('end_line must be >= start_line');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    const start = Math.min(startLine, totalLines);
    const end = Math.min(endLine, totalLines);

    // 1-indexed to 0-indexed
    const selectedLines = lines.slice(start - 1, end);

    // Return with line numbers
    const numbered = selectedLines.map((line, i) => `${start + i}: ${line}`).join('\n');
    return `Lines ${start}-${end} of ${totalLines} total:\n${numbered}`;
}

export const fsReadFileRangeTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
