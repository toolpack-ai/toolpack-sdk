import { readFileSync, statSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory, sharedFileIndex } from '../../parsers/shared.js';
import { ReferenceInfo } from '../../parsers/types.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function findReferencesInFile(filePath: string, symbolName: string, includeDeclaration: boolean): Promise<ReferenceInfo[]> {
    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);
        return await parser.findReferences({
            filePath,
            content: code
        }, symbolName, includeDeclaration);
    } catch (error) {
        // Skip files that can't be parsed
        return [];
    }
}

async function searchDirectory(dirPath: string, symbolName: string, includeDeclaration: boolean): Promise<ReferenceInfo[]> {
    const results: ReferenceInfo[] = [];

    // Lazy load the index for the workspace directory
    await sharedFileIndex.buildIndex(dirPath);

    // Get the exact files where this symbol exists
    const candidateFiles = await sharedFileIndex.getDefinitionFiles(symbolName, dirPath);

    for (const file of candidateFiles) {
        if (file.startsWith(dirPath)) {
            const fileResults = await findReferencesInFile(file, symbolName, includeDeclaration);
            results.push(...fileResults);
        }
    }

    return results;
}

async function execute(args: Record<string, any>): Promise<string> {
    const symbolName = args.symbol as string;
    const path = args.path as string;
    const includeDeclaration = args.includeDeclaration === true;
    logDebug(`[coding.find-references] execute symbol="${symbolName}" path="${path}" includeDecl=${includeDeclaration}`);

    if (!symbolName) {
        throw new Error('symbol is required');
    }

    if (!path) {
        throw new Error('path is required');
    }

    const stats = statSync(path);
    let results: ReferenceInfo[];

    if (stats.isDirectory()) {
        results = await searchDirectory(path, symbolName, includeDeclaration);
    } else if (stats.isFile()) {
        results = await findReferencesInFile(path, symbolName, includeDeclaration);
    } else {
        throw new Error(`Path is neither a file nor directory: ${path}`);
    }

    return JSON.stringify({
        symbol: symbolName,
        found: results.length,
        references: results,
    }, null, 2);
}

export const codingFindReferencesTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
