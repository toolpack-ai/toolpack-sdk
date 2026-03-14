import { readFileSync, statSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { sharedParserFactory } from '../../parsers/shared.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.file as string;

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

        if (!parser.getDiagnostics) {
            return JSON.stringify({
                file: filePath,
                error: `Diagnostics extraction is not specifically implemented for this language yet.`
            });
        }

        const diagnostics = await parser.getDiagnostics({
            filePath,
            content: code
        });

        return JSON.stringify({
            file: filePath,
            diagnostics,
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to get diagnostics from file "${filePath}": ${error.message}`);
    }
}

export const codingGetDiagnosticsTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
