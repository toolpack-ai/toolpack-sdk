import { readFileSync, statSync } from 'fs';
import { dirname } from 'path';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory, sharedFileIndex } from '../../parsers/shared.js';
import { SymbolLocation } from '../../parsers/types.js';

async function getSymbolAtPosition(filePath: string, line: number, column: number): Promise<string | null> {
    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);
        return await parser.getSymbolAtPosition({
            filePath,
            content: code
        }, line, column);
    } catch (error) {
        return null;
    }
}

async function findDefinitionInFile(filePath: string, symbolName: string): Promise<SymbolLocation | null> {
    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);
        return await parser.getDefinition({
            filePath,
            content: code
        }, symbolName);
    } catch (error) {
        return null;
    }
}

async function searchForDefinition(dirPath: string, symbolName: string): Promise<SymbolLocation | null> {
    await sharedFileIndex.buildIndex(dirPath);
    const candidateFiles = await sharedFileIndex.getDefinitionFiles(symbolName, dirPath);

    for (const file of candidateFiles) {
        if (file.startsWith(dirPath)) {
            const result = await findDefinitionInFile(file, symbolName);
            if (result) return result;
        }
    }

    return null;
}

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.file as string;
    const line = args.line as number;
    const column = args.column as number;
    const searchPath = args.searchPath as string | undefined;

    if (!filePath) {
        throw new Error('file is required');
    }

    if (line === undefined) {
        throw new Error('line is required');
    }

    if (column === undefined) {
        throw new Error('column is required');
    }

    // Get the symbol at the specified position
    const symbolName = await getSymbolAtPosition(filePath, line, column);

    if (!symbolName) {
        return JSON.stringify({
            found: false,
            message: `No symbol found at ${filePath}:${line}:${column}`,
        }, null, 2);
    }

    // First check the current file
    let definition = await findDefinitionInFile(filePath, symbolName);

    if (!definition) {
        const searchDir = searchPath || dirname(filePath);
        const stats = statSync(searchDir);
        if (stats.isDirectory()) {
            definition = await searchForDefinition(searchDir, symbolName);
        }
    }

    if (definition) {
        return JSON.stringify({
            found: true,
            symbol: symbolName,
            definition,
        }, null, 2);
    } else {
        return JSON.stringify({
            found: false,
            symbol: symbolName,
            message: `Definition not found for symbol "${symbolName}"`,
        }, null, 2);
    }
}

export const codingGoToDefinitionTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
