import { execSync } from 'child_process';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;
    const timeout = (args.timeout || 30000) as number;

    if (!command) {
        throw new Error('command is required');
    }

    try {
        const output = execSync(command, {
            cwd,
            timeout,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return output || '(command completed with no output)';
    } catch (error: any) {
        const stdout = error.stdout || '';
        const stderr = error.stderr || '';
        const exitCode = error.status ?? 'unknown';
        return `Command failed (exit code ${exitCode}):\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
    }
}

export const execRunTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
