import { readFileSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory } from '../../parsers/shared.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.file as string;
    logDebug(`[coding.get-imports] execute file="${filePath}"`);

    if (!filePath) {
        throw new Error('file is required');
    }

    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);

        const imports = await parser.getImports({
            filePath,
            content: code
        });

        return JSON.stringify({
            file: filePath,
            count: imports.length,
            imports,
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to map explicit imports in file "${filePath}": ${error.message}`);
    }
}

export const codingGetImportsTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
