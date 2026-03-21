import { ToolDefinition } from '../../../types.js';
import { diffCreateSchema } from './schema.js';
import * as diff from 'diff';
import { logDebug } from '../../../../providers/provider-logger.js';

export const diffCreateTool: ToolDefinition = {
    name: 'diff.create',
    displayName: 'Create Diff',
    description: 'Generate a unified diff from two text contents.',
    category: 'diff',
    parameters: diffCreateSchema,
    execute: async (args: Record<string, unknown>) => {
        const oldContent = args.oldContent as string;
        const newContent = args.newContent as string;
        const fileName = (args.fileName as string) || 'file';
        const contextLines = (args.contextLines as number) ?? 4;
        logDebug(`[diff.create] execute fileName="${fileName}" contextLines=${contextLines}`);

        try {
            const patch = diff.createPatch(fileName, oldContent, newContent, '', '', { context: contextLines });
            return patch;
        } catch (error: unknown) {
            return `Error creating diff: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
