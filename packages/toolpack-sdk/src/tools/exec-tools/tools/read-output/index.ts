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

    const alive = managed.process.exitCode === null;
    return JSON.stringify({
        id: managed.id,
        alive,
        exitCode: managed.process.exitCode,
        stdout: managed.stdout,
        stderr: managed.stderr,
    });
}

export const execReadOutputTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
