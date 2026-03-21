import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const key = args.key as string | undefined;
    logDebug(`[system.env] execute key=${key ?? 'all'}`);

    if (key) {
        const value = process.env[key];
        if (value === undefined) {
            return `Environment variable "${key}" is not set.`;
        }
        return JSON.stringify({ [key]: value });
    }

    // Return all env vars (sorted by key)
    const sorted: Record<string, string> = {};
    const keys = Object.keys(process.env).sort();
    for (const k of keys) {
        if (process.env[k] !== undefined) {
            sorted[k] = process.env[k]!;
        }
    }
    return JSON.stringify(sorted, null, 2);
}

export const systemEnvTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
