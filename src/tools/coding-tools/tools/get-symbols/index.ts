import { readFileSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory } from '../../parsers/shared.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.file as string;
    const kindFilter = args.kind as string | undefined;
    logDebug(`[coding.get-symbols] execute file="${filePath}" kind=${kindFilter ?? 'all'}`);

    if (!filePath) {
        throw new Error('file is required');
    }

    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);

        const symbols = await parser.getSymbols({
            filePath,
            content: code
        }, kindFilter);

        return JSON.stringify({
            file: filePath,
            count: symbols.length,
            symbols,
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to parse file "${filePath}": ${error.message}`);
    }
}

export const codingGetSymbolsTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
