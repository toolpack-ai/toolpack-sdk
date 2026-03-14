import { ToolDefinition } from '../../../types.js';
import { gitBlameSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitBlameTool: ToolDefinition = {
    name: 'git.blame',
    displayName: 'Git Blame',
    description: 'Show what revision and author last modified each line of a file.',
    category: 'version-control',
    parameters: gitBlameSchema,
    execute: async (args: Record<string, unknown>) => {
        const path = args.path as string;

        try {
            const git = getGit();
            const result = await git.raw(['blame', path]);
            return result;
        } catch (error: unknown) {
            return `Error running git blame: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
