import { readFile } from 'fs/promises';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

interface FileReadResult {
    path: string;
    content?: string;
    error?: string;
    success: boolean;
}

async function execute(args: Record<string, any>): Promise<string> {
    const paths = args.paths as string[];
    const encoding = (args.encoding || 'utf-8') as BufferEncoding;
    const continueOnError = args.continueOnError !== false;

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        throw new Error('paths array is required and must not be empty');
    }

    const results: FileReadResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const path of paths) {
        try {
            const content = await readFile(path, encoding);
            results.push({
                path,
                content,
                success: true,
            });
            successCount++;
        } catch (error: any) {
            const errorMsg = error.message;
            results.push({
                path,
                error: errorMsg,
                success: false,
            });
            errorCount++;

            if (!continueOnError) {
                throw new Error(`Failed to read file "${path}": ${errorMsg}`);
            }
        }
    }

    return JSON.stringify({
        total: paths.length,
        success: successCount,
        failed: errorCount,
        results,
    }, null, 2);
}

export const fsBatchReadTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
