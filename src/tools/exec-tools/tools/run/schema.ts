import { ToolParameters } from '../../../types.js';

export const name = 'exec.run';
export const displayName = 'Run';
export const description = 'Execute a command directly (without shell) and return its output. Use exec.run_shell for pipes, redirects, or shell features.';
export const category = 'execution';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        command: {
            type: 'string',
            description: 'The command to execute',
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
