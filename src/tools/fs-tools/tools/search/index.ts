import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

interface SearchMatch {
    file: string;
    line: number;
    content: string;
}

function searchInFile(filePath: string, query: string | RegExp, matches: SearchMatch[], maxResults: number): void {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
            const line = lines[i];
            const isMatch = typeof query === 'string' ? line.includes(query) : query.test(line);
            if (isMatch) {
                matches.push({
                    file: filePath,
                    line: i + 1,
                    content: line.trim(),
                });
            }
        }
    } catch {
        // Skip files that can't be read (binary, permissions, etc.)
    }
}

function searchDir(dirPath: string, query: string | RegExp, recursive: boolean, matches: SearchMatch[], maxResults: number): void {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
        if (matches.length >= maxResults) break;

        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory() && recursive) {
            searchDir(fullPath, query, true, matches, maxResults);
        } else if (item.isFile()) {
            searchInFile(fullPath, query, matches, maxResults);
        }
    }
}

async function execute(args: Record<string, unknown>): Promise<string> {
    const dirPath = args.path as string;
    const rawQuery = args.query as string;
    const recursive = args.recursive !== false;
    const maxResults = (args.max_results || 50) as number;
    const isRegex = !!args.regex;
    const isCaseSensitive = !!args.case_sensitive;

    if (!dirPath) {
        throw new Error('path is required');
    }
    if (!rawQuery) {
        throw new Error('query is required');
    }

    let query: string | RegExp = rawQuery;

    if (isRegex || !isCaseSensitive) {
        let pattern = rawQuery;
        if (!isRegex) {
            pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        const flags = isCaseSensitive ? '' : 'i';
        query = new RegExp(pattern, flags);
    }

    if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory not found: ${dirPath}`);
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
    }

    const matches: SearchMatch[] = [];
    searchDir(dirPath, query, recursive, matches, maxResults);

    if (matches.length === 0) {
        return `No matches found for "${rawQuery}" in ${dirPath}`;
    }

    const truncated = matches.length >= maxResults ? `\n(results capped at ${maxResults})` : '';
    return JSON.stringify(matches, null, 2) + truncated;
}

export const fsSearchTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
