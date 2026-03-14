import { ToolParameters } from '../../../types.js';

export const name = 'exec.run_shell';
export const displayName = 'Run Shell';
export const description = 'Execute a command through the system shell. Supports pipes, redirects, environment variable expansion, and other shell features.';
export const category = 'execution';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        command: {
            type: 'string',
            description: 'The shell command to execute (supports pipes, redirects, etc.)',
        },
        cwd: {
            type: 'string',
            description: 'Working directory for the command (optional)',
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
    },
    required: ['command'],
};
