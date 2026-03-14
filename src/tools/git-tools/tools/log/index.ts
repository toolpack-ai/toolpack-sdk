import { ToolDefinition } from '../../../types.js';
import { gitLogSchema } from './schema.js';
import { getGit } from '../../utils.js';

export const gitLogTool: ToolDefinition = {
    name: 'git.log',
    displayName: 'Git Log',
    description: 'Show commit logs.',
    category: 'version-control',
    parameters: gitLogSchema,
    execute: async (args: Record<string, unknown>) => {
        const maxCount = (args.maxCount as number) || 10;
        const path = args.path as string | undefined;

        try {
            const git = getGit();

            const options: Record<string, unknown> = { maxCount };
            if (path) {
                options['file'] = path;
            }

            const log = await git.log(options);

            if (log.all.length === 0) {
                return 'No commits found.';
            }

            return log.all.map((commit: { hash: string; author_name: string; author_email: string; date: string; message: string }) =>
                `Commit: ${commit.hash}\n` +
                `Author: ${commit.author_name} <${commit.author_email}>\n` +
                `Date: ${commit.date}\n` +
                `Message: ${commit.message}\n`
            ).join('---\n');
        } catch (error: unknown) {
            return `Error getting git log: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
