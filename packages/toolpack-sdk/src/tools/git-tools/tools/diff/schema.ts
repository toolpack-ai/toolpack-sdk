import { ToolParameters } from '../../../types.js';

export const gitDiffSchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Optional path to get the diff for. If omitted, gets the diff for the entire repository.',
        },
        base: {
            type: 'string',
            description: 'Optional base commit/ref for comparing two revisions. When used with head, runs git diff base...head.',
        },
        head: {
            type: 'string',
            description: 'Optional head commit/ref for comparing two revisions. When used with base, runs git diff base...head.',
        },
        staged: {
            type: 'boolean',
            description: 'If true, gets the diff of staged changes instead of unstaged changes.',
            default: false,
        },
        cloneDir: {
            type: 'string',
            description: 'Optional local repository directory, typically the cloneDir returned by git.clone. When provided, this tool runs in that repository instead of the current working directory.',
        },
    },
};
