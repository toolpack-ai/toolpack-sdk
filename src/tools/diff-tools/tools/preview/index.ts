import { ToolDefinition } from '../../../types.js';
import { diffPreviewSchema } from './schema.js';
import * as diff from 'diff';
import { promises as fs } from 'fs';

export const diffPreviewTool: ToolDefinition = {
    name: 'diff.preview',
    displayName: 'Preview Diff',
    description: 'Preview the result of applying a patch to a file without modifying it.',
    category: 'diff',
    parameters: diffPreviewSchema,
    execute: async (args: Record<string, unknown>) => {
        const path = args.path as string;
        const patch = args.patch as string;

        try {
            const fileContent = await fs.readFile(path, 'utf8');
            const result = diff.applyPatch(fileContent, patch);
            if (result === false) {
                return 'Patch preview failed. The patch would not apply cleanly.';
            }
            return `Preview of ${path} after patch:\n\n${result}`;
        } catch (error: unknown) {
            return `Error previewing patch: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
