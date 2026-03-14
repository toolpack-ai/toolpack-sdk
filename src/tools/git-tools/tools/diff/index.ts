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
        const staged = args.staged as boolean | undefined;

        try {
            const git = getGit();
            const options: string[] = [];

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
