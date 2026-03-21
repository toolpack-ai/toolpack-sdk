import { execSync } from 'child_process';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';

function getDefaultShell(): string {
    const platform = process.platform;
    if (platform === 'win32') {
        return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/sh';
}

async function execute(args: Record<string, any>): Promise<string> {
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;
    const timeout = (args.timeout || 30000) as number;

    if (!command) {
        throw new Error('command is required');
    }
    logDebug(`[exec.run-shell] execute command="${command.substring(0, 100)}" cwd=${cwd ?? 'default'} timeout=${timeout}ms`);

    try {
        const output = execSync(command, {
            cwd,
            timeout,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: getDefaultShell(),
        });
        return output || '(command completed with no output)';
    } catch (error: any) {
        const stdout = error.stdout || '';
        const stderr = error.stderr || '';
        const exitCode = error.status ?? 'unknown';
        return `Command failed (exit code ${exitCode}):\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
    }
}

export const execRunShellTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
