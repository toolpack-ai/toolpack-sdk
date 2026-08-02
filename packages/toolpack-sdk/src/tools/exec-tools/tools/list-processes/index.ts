import { ToolDefinition, ToolContext } from '../../../types.js';
import { defaultRegistry } from '../../process-registry.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(_args: Record<string, any>, ctx?: ToolContext): Promise<string> {
    const registry = ctx?.processRegistry ?? defaultRegistry;
    const processes = registry.list();

    if (processes.length === 0) {
        return 'No managed background processes.';
    }

    return JSON.stringify(processes, null, 2);
}

export const execListProcessesTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
