import { readFileSync, statSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory } from '../../parsers/shared.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.file as string;
    const startLine = args.startLine as number;
    const startColumn = args.startColumn as number;
    const endLine = args.endLine as number;
    const endColumn = args.endColumn as number;
    const newFunctionName = args.newFunctionName as string;

    if (!filePath) throw new Error('file is required');
    if (startLine === undefined) throw new Error('startLine is required');
    if (startColumn === undefined) throw new Error('startColumn is required');
    if (endLine === undefined) throw new Error('endLine is required');
    if (endColumn === undefined) throw new Error('endColumn is required');
    if (!newFunctionName) throw new Error('newFunctionName is required');

    try {
        const stats = statSync(filePath);
        if (!stats.isFile()) throw new Error(`Path is not a file: ${filePath}`);
    } catch {
        throw new Error(`File not found: ${filePath}`);
    }

    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);

        if (!parser.extractFunction) {
            return JSON.stringify({
                file: filePath,
                error: `Function extraction is not specifically implemented for this language yet.`
            });
        }

        const result = await parser.extractFunction({
            filePath,
            content: code
        }, startLine, startColumn, endLine, endColumn, newFunctionName);

        return JSON.stringify({
            file: filePath,
            result,
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to extract function from file "${filePath}": ${error.message}`);
    }
}

export const codingExtractFunctionTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
