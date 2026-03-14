import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(_args: Record<string, any>): Promise<string> {
    return JSON.stringify({ cwd: process.cwd() });
}

export const systemCwdTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
