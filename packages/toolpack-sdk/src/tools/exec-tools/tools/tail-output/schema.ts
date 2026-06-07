import { ToolParameters } from '../../../types.js';

export const name = 'exec.tail_output';
export const displayName = 'Tail Process Output';
export const description = 'Read the last N lines of output from a background process started with exec.run_background. ' +
    'Use this to monitor long-running or non-exiting processes (e.g. dev servers, watchers) ' +
    'to detect ready signals, errors, or progress without reading all accumulated output. ' +
    'Returns alive status, exit code, and the most recent lines of stdout and stderr.';
export const category = 'execution';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        process_id: {
            type: 'string',
            description: 'The process ID returned by exec.run_background.',
        },
        lines: {
            type: 'integer',
            description: 'Number of lines to return from the end of stdout (default: 20).',
            default: 20,
        },
    },
    required: ['process_id'],
};
