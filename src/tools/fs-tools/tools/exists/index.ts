import * as fs from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const filePath = args.path as string;

    if (!filePath) {
        throw new Error('path is required');
    }

    const exists = fs.existsSync(filePath);
    return JSON.stringify({ exists, path: filePath });
}

export const fsExistsTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
