import { ToolDefinition } from '../../../types.js';
import { gitCommitSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitCommitTool: ToolDefinition = {
    name: 'git.commit',
    displayName: 'Git Commit',
    description: 'Record changes to the repository.',
    category: 'version-control',
    parameters: gitCommitSchema,
    execute: async (args: Record<string, unknown>) => {
        const message = args.message as string;

        try {
            const git = getGit();
            const result = await git.commit(message);

            if (result.commit) {
                return `Successfully committed changes.\nCommit: ${result.commit}\nBranch: ${result.branch}\nSummary: ${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions.`;
            } else {
                return 'Nothing to commit.';
            }
        } catch (error: unknown) {
            return `Error committing changes: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
