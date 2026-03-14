import { ToolDefinition } from '../../../types.js';
import { listProcesses } from '../../process-registry.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(_args: Record<string, any>): Promise<string> {
    const processes = listProcesses();

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
