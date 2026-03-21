import { readFileSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory } from '../../parsers/shared.js';
import { SymbolLocation } from '../../parsers/types.js';
import { logDebug } from '../../../../providers/provider-logger.js';

const SUPPORTED_EXTENSIONS = [
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp'
];

async function findSymbolsInFile(filePath: string, symbolName: string, kindFilter?: string): Promise<SymbolLocation[]> {
    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);
        return await parser.findSymbols({
            filePath,
            content: code
        }, symbolName, kindFilter);
    } catch (error) {
        // Skip files that can't be parsed
        return [];
    }
}

async function searchDirectory(dirPath: string, symbolName: string, kindFilter?: string): Promise<SymbolLocation[]> {
    const results: SymbolLocation[] = [];

    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);

            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
                continue;
            }

            if (entry.isDirectory()) {
                const subResults = await searchDirectory(fullPath, symbolName, kindFilter);
                results.push(...subResults);
            } else if (entry.isFile() && SUPPORTED_EXTENSIONS.includes(extname(entry.name))) {
                const fileResults = await findSymbolsInFile(fullPath, symbolName, kindFilter);
                results.push(...fileResults);
            }
        }
    } catch (error) {
        // Skip directories we can't read
    }

    return results;
}

async function execute(args: Record<string, any>): Promise<string> {
    const symbolName = args.symbol as string;
    const path = args.path as string;
    const kindFilter = args.kind as string | undefined;
    logDebug(`[coding.find-symbol] execute symbol="${symbolName}" path="${path}" kind=${kindFilter ?? 'all'}`);

    if (!symbolName) {
        throw new Error('symbol is required');
    }

    if (!path) {
        throw new Error('path is required');
    }

    const stats = statSync(path);
    let results: SymbolLocation[];

    if (stats.isDirectory()) {
        results = await searchDirectory(path, symbolName, kindFilter);
    } else if (stats.isFile()) {
        results = await findSymbolsInFile(path, symbolName, kindFilter);
    } else {
        throw new Error(`Path is neither a file nor directory: ${path}`);
    }

    return JSON.stringify({
        symbol: symbolName,
        found: results.length,
        locations: results,
    }, null, 2);
}

export const codingFindSymbolTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
