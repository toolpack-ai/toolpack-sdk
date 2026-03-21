import { ToolDefinition } from '../../../types.js';
import { diffApplySchema } from './schema.js';
import * as diff from 'diff';
import { promises as fs } from 'fs';
import { logDebug } from '../../../../providers/provider-logger.js';

export const diffApplyTool: ToolDefinition = {
    name: 'diff.apply',
    displayName: 'Apply Diff',
    description: 'Apply a unified diff patch to a file.',
    category: 'diff',
    parameters: diffApplySchema,
    execute: async (args: Record<string, unknown>) => {
        const path = args.path as string;
        const patch = args.patch as string;
        logDebug(`[diff.apply] execute path="${path}"`);

        try {
            const fileContent = await fs.readFile(path, 'utf8');
            const result = diff.applyPatch(fileContent, patch);
            if (result === false) {
                return 'Failed to apply patch. The patch may be malformed or conflicting with the current file content.';
            }
            await fs.writeFile(path, result, 'utf8');
            return `Successfully applied patch to ${path}`;
        } catch (error: unknown) {
            return `Error applying patch: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
