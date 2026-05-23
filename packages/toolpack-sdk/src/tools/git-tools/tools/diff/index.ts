import { ToolDefinition } from '../../../types.js';
import { gitDiffSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitDiffTool: ToolDefinition = {
    name: 'git.diff',
    displayName: 'Git Diff',
    description: 'Show changes between commits, commit and working tree, etc.',
    category: 'version-control',
    parameters: gitDiffSchema,
    execute: async (args: Record<string, unknown>) => {
        const path = args.path as string | undefined;
        const base = args.base as string | undefined;
        const head = args.head as string | undefined;
        const staged = args.staged as boolean | undefined;
        const cloneDir = args.cloneDir as string | undefined;

        try {
            const git = getGit(cloneDir);
            const options: string[] = [];

            if (base || head) {
                if (!base || !head) {
                    return 'Error getting git diff: both base and head are required when comparing revisions.';
                }
                options.push(`${base}...${head}`);
            }
            if (staged) {
                options.push('--cached');
            }
            if (path) {
                options.push('--', path);
            }

            const diff = await git.diff(options);

            if (!diff) {
                return 'No changes found.';
            }

            return diff;
        } catch (error: unknown) {
            return `Error getting git diff: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
