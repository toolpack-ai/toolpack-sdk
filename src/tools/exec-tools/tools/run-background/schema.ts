import { ToolParameters } from '../../../types.js';

export const name = 'exec.run_background';
export const displayName = 'Run Background';
export const description = 'Start a command as a background process. Returns a process ID that can be used with exec.read_output, exec.kill, and exec.list_processes.';
export const category = 'execution';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        command: {
            type: 'string',
            description: 'The command to run in the background',
        },
        cwd: {
            type: 'string',
            description: 'Working directory for the command (optional)',
        },
    },
    required: ['command'],
};
