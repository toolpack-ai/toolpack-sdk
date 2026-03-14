import { ToolDefinition } from '../../../types.js';
import { gitStatusSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitStatusTool: ToolDefinition = {
    name: 'git.status',
    displayName: 'Git Status',
    description: 'Get the working tree status, including modified, staged, and untracked files.',
    category: 'version-control',
    parameters: gitStatusSchema,
    execute: async (args: Record<string, unknown>) => {
        const path = args.path as string | undefined;
        try {
            const git = getGit();
            const status = await git.status(path ? [path] : []);

            if (status.isClean()) {
                return 'Working tree clean';
            }

            const output: string[] = [];
            output.push(`Branch: ${status.current}`);
            if (status.tracking) output.push(`Tracking: ${status.tracking}`);
            if (status.ahead > 0) output.push(`Ahead: ${status.ahead}`);
            if (status.behind > 0) output.push(`Behind: ${status.behind}`);
            output.push('---');

            if (status.conflicted.length > 0) output.push(`Conflicted: ${status.conflicted.join(', ')}`);
            if (status.created.length > 0) output.push(`Created: ${status.created.join(', ')}`);
            if (status.deleted.length > 0) output.push(`Deleted: ${status.deleted.join(', ')}`);
            if (status.modified.length > 0) output.push(`Modified: ${status.modified.join(', ')}`);
            if (status.renamed.length > 0) output.push(`Renamed: ${status.renamed.map((r: { from: string, to: string }) => `${r.from} -> ${r.to}`).join(', ')}`);
            if (status.staged.length > 0) output.push(`Staged: ${status.staged.join(', ')}`);
            if (status.not_added.length > 0) output.push(`Untracked: ${status.not_added.join(', ')}`);

            return output.join('\n');
        } catch (error: unknown) {
            return `Error getting git status: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
