import { readFileSync, statSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory } from '../../parsers/shared.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.file as string;
    logDebug(`[coding.get-outline] execute file="${filePath}"`);

    if (!filePath) {
        throw new Error('file is required');
    }

    try {
        const stats = statSync(filePath);
        if (!stats.isFile()) {
            throw new Error(`Path is not a file: ${filePath}`);
        }
    } catch {
        throw new Error(`File not found: ${filePath}`);
    }

    try {
        const code = readFileSync(filePath, 'utf-8');
        const parser = sharedParserFactory.getParser(filePath);

        if (!parser.getOutline) {
            return JSON.stringify({
                file: filePath,
                error: `Outline extraction is not specifically implemented for this language yet.`
            });
        }

        const outline = await parser.getOutline({
            filePath,
            content: code
        });

        return JSON.stringify({
            file: filePath,
            outline,
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to safely extract outline from file "${filePath}": ${error.message}`);
    }
}

export const codingGetOutlineTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
