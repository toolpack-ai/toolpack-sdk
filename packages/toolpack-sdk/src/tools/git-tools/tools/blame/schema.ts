import { ToolParameters } from '../../../types.js';

export const gitBlameSchema: ToolParameters = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Path to the file to blame.',
        },
        sha: {
            type: 'string',
            description: 'Optional commit SHA or ref to blame at. If omitted, blames the current checkout.',
        },
        cloneDir: {
            type: 'string',
            description: 'Optional local repository directory, typically the cloneDir returned by git.clone. When provided, this tool runs in that repository instead of the current working directory.',
        },
    },
    required: ['path'],
};
