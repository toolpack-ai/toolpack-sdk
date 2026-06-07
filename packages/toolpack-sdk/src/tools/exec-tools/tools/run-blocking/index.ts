import { spawn } from 'child_process';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { logDebug } from '../../../../providers/provider-logger.js';

function getDefaultShell(): string {
    if (process.platform === 'win32') return 'powershell.exe';
    return process.env.SHELL || '/bin/sh';
}

async function execute(args: Record<string, any>): Promise<string> {
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;

    if (!command) {
        throw new Error('command is required');
    }

    logDebug(`[exec.run-blocking] execute command="${command.substring(0, 100)}" cwd=${cwd ?? 'default'} (no timeout)`);

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';

        const proc = spawn(command, [], {
            cwd,
            shell: getDefaultShell(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
            // Cap buffer at 2MB
            if (stdout.length > 2_000_000) {
                stdout = stdout.slice(-1_000_000);
            }
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
            if (stderr.length > 2_000_000) {
                stderr = stderr.slice(-1_000_000);
            }
        });

        proc.on('close', (code) => {
            const exitCode = code ?? 0;
            logDebug(`[exec.run-blocking] finished exitCode=${exitCode} stdout_len=${stdout.length} stderr_len=${stderr.length}`);
            resolve(JSON.stringify({
                exitCode,
                stdout: stdout || '(no output)',
                stderr: stderr || '',
                success: exitCode === 0,
            }));
        });

        proc.on('error', (err) => {
            logDebug(`[exec.run-blocking] spawn error: ${err.message}`);
            resolve(JSON.stringify({
                exitCode: 1,
                stdout: '',
                stderr: err.message,
                success: false,
            }));
        });
    });
}

export const execRunBlockingTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
    confirmation: {
        level: 'medium',
        reason: 'This will execute a shell command and block until it completes.',
        showArgs: ['command'],
    },
};
