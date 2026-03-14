import { ToolDefinition } from '../../../types.js';
import { killProcess, getProcess } from '../../process-registry.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const processId = args.process_id as string;

    if (!processId) {
        throw new Error('process_id is required');
    }

    const managed = getProcess(processId);
    if (!managed) {
        throw new Error(`Process not found: ${processId}`);
    }

    const wasAlive = killProcess(processId);
    if (wasAlive) {
        return `Process ${processId} (${managed.command}) killed successfully.`;
    } else {
        return `Process ${processId} (${managed.command}) was already terminated (exit code: ${managed.process.exitCode}).`;
    }
}

export const execKillTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
