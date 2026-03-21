import { spawn } from 'child_process';
import { ToolDefinition } from '../../../types.js';
import { registerProcess } from '../../process-registry.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';

async function execute(args: Record<string, any>): Promise<string> {
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;

    if (!command) {
        throw new Error('command is required');
    }
    logDebug(`[exec.run-background] execute command="${command.substring(0, 100)}" cwd=${cwd ?? 'default'}`);

    if (!command) {
        throw new Error('command is required');
    }

    const proc = spawn(command, [], {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    const id = registerProcess(command, cwd, proc);

    return JSON.stringify({
        id,
        pid: proc.pid,
        command,
        message: `Background process started. Use exec.read_output("${id}") to read output, exec.kill("${id}") to stop.`,
    });
}

export const execRunBackgroundTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
