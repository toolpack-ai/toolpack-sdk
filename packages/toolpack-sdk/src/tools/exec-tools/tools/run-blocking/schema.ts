import { ToolParameters } from '../../../types.js';

export const name = 'exec.run_blocking';
export const displayName = 'Run Blocking';
export const description = 'Execute a shell command and wait for it to finish naturally — no timeout. ' +
    'Use this for commands that take variable or unknown time (e.g. npm install, builds, tests). ' +
    'Returns exit code, stdout, and stderr when the process exits. ' +
    'For processes that never exit (servers, watchers), use exec.run_background instead.';
export const category = 'execution';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        command: {
            type: 'string',
            description: 'The shell command to execute. Supports pipes, redirects, and shell features.',
        },
        cwd: {
            type: 'string',
            description: 'Working directory for the command (optional). Defaults to the current working directory.',
        },
    },
    required: ['command'],
};
