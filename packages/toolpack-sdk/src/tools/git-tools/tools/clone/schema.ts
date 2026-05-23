import { ToolParameters } from '../../../types.js';

export const gitCloneSchema: ToolParameters = {
    type: 'object',
    properties: {
        repo: {
            type: 'string',
            description: 'The repository to clone in "owner/repo" format (e.g., "microsoft/typescript").',
        },
        sha: {
            type: 'string',
            description: 'The commit SHA to checkout (always use SHAs, never branch names — handles force-pushes correctly).',
        },
        filter: {
            type: 'string',
            description: 'Git partial clone filter. "blob:none" (default) skips file blobs for a fast clone — blobs are fetched on demand when you read files or run git blame. Use "none" when you need immediate access to all file contents without extra fetches (e.g. heavy blame across many files).',
            default: 'blob:none',
        },
        depth: {
            type: 'number',
            description: 'Commit history depth. Default 50 is enough for most PR reviews. Use 0 for full history when you need complete git log or blame across a long-lived file.',
            default: 50,
        },
        cloneRoot: {
            type: 'string',
            description: 'Override the local directory where clones are stored. Leave unset in almost all cases — the default is managed automatically.',
        },
    },
    required: ['repo', 'sha'],
};
