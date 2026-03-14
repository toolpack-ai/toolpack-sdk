import { ToolDefinition } from '../../../types.js';
import { gitBranchListSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitBranchListTool: ToolDefinition = {
    name: 'git.branch_list',
    displayName: 'Git Branch List',
    description: 'List all branches.',
    category: 'version-control',
    parameters: gitBranchListSchema,
    execute: async (args: Record<string, unknown>) => {
        const remote = args.remote as boolean | undefined;

        try {
            const git = getGit();
            const options = remote ? ['-a'] : [];
            const branches = await git.branch(options);

            return `Current Branch: ${branches.current}\n\nBranches:\n${branches.all.join('\n')}`;
        } catch (error: unknown) {
            return `Error listing branches: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
