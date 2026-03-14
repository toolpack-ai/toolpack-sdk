import { ToolDefinition } from '../../../types.js';
import { gitAddSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitAddTool: ToolDefinition = {
    name: 'git.add',
    displayName: 'Git Add',
    description: 'Add file contents to the index (stage changes).',
    category: 'version-control',
    parameters: gitAddSchema,
    execute: async (args: Record<string, unknown>) => {
        const path = args.path as string;

        try {
            const git = getGit();
            await git.add(path);
            return `Successfully staged changes for: ${path}`;
        } catch (error: unknown) {
            return `Error staging changes: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
