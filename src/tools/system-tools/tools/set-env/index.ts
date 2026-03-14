import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const key = args.key as string;
    const value = args.value as string;

    if (!key) {
        throw new Error('key is required');
    }
    if (value === undefined || value === null) {
        throw new Error('value is required');
    }

    const previous = process.env[key];
    process.env[key] = value;

    if (previous !== undefined) {
        return `Environment variable "${key}" updated (was: "${previous}", now: "${value}")`;
    }
    return `Environment variable "${key}" set to "${value}"`;
}

export const systemSetEnvTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
