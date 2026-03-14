import { ToolDefinition } from '../../../types.js';
import { getProcess } from '../../process-registry.js';
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
