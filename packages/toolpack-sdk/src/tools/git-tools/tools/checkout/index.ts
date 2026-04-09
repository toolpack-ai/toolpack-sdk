import { ToolDefinition } from '../../../types.js';
import { gitCheckoutSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitCheckoutTool: ToolDefinition = {
    name: 'git.checkout',
    displayName: 'Git Checkout',
    description: 'Switch branches or restore working tree files.',
    category: 'version-control',
    parameters: gitCheckoutSchema,
    execute: async (args: Record<string, unknown>) => {
        const branch = args.branch as string;

        try {
            const git = getGit();
            await git.checkout(branch);
            return `Successfully checked out: ${branch}`;
        } catch (error: unknown) {
            return `Error checking out branch: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
    confirmation: {
        level: 'medium',
        reason: 'This will switch branches, potentially losing uncommitted changes.',
        showArgs: ['branch'],
    },
};
