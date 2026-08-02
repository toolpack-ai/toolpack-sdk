import { ToolDefinition, ToolContext } from '../../../types.js';
import { defaultRegistry } from '../../process-registry.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>, ctx?: ToolContext): Promise<string> {
    const processId = args.process_id as string;

    if (!processId) {
        throw new Error('process_id is required');
    }

    const registry = ctx?.processRegistry ?? defaultRegistry;
    const managed = registry.get(processId);
    if (!managed) {
        throw new Error(`Process not found: ${processId}`);
    }

    const wasAlive = registry.kill(processId);
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
    confirmation: {
        level: 'medium',
        reason: 'This will terminate a running process.',
        showArgs: ['process_id'],
    },
};
