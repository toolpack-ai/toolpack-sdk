import { ToolDefinition } from '../../../types.js';
import { gitBranchCreateSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitBranchCreateTool: ToolDefinition = {
    name: 'git.branch_create',
    displayName: 'Git Branch Create',
    description: 'Create a new branch.',
    category: 'version-control',
    parameters: gitBranchCreateSchema,
    execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const checkout = args.checkout as boolean | undefined;
        const startPoint = args.startPoint as string | undefined;

        try {
            const git = getGit();

            if (checkout) {
                if (startPoint) {
                    await git.checkoutBranch(name, startPoint);
                } else {
                    await git.checkoutLocalBranch(name);
                }
                return `Successfully created and switched to branch: ${name}`;
            } else {
                if (startPoint) {
                    await git.branch([name, startPoint]);
                } else {
                    await git.branch([name]);
                }
                return `Successfully created branch: ${name}`;
            }
        } catch (error: unknown) {
            return `Error creating branch: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
