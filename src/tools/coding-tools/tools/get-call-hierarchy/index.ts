import { readFileSync, statSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory } from '../../parsers/shared.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.file as string;
    const line = args.line as number;
    const column = args.column as number;

    if (!filePath) throw new Error('file is required');
    if (line === undefined) throw new Error('line is required');
    if (column === undefined) throw new Error('column is required');

    try {
        const stats = statSync(filePath);
        if (!stats.isFile()) throw new Error(`Path is not a file: ${filePath}`);
    } catch {
        throw new Error(`File not found: ${filePath}`);
    }

    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);

        if (!parser.getCallHierarchy) {
            return JSON.stringify({
                file: filePath,
                error: `Call hierarchy is not specifically implemented for this language yet.`
            });
        }

        const hierarchy = await parser.getCallHierarchy({
            filePath,
            content: code
        }, line, column);

        return JSON.stringify({
            file: filePath,
            hierarchy,
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to get call hierarchy from file "${filePath}": ${error.message}`);
    }
}

export const codingGetCallHierarchyTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
