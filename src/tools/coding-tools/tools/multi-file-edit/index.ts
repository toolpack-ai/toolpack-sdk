import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

interface Change {
    oldText: string;
    newText: string;
}

interface FileEdit {
    file: string;
    changes: Change[];
}

interface Backup {
    file: string;
    content: string;
}

async function execute(args: Record<string, any>): Promise<string> {
    const edits = args.edits as FileEdit[];
    const atomic = args.atomic !== false;

    if (!edits || !Array.isArray(edits) || edits.length === 0) {
        throw new Error('edits array is required and must not be empty');
    }

    // Validate all edits
    for (const edit of edits) {
        if (!edit.file) {
            throw new Error('Each edit must have a file property');
        }
        if (!edit.changes || !Array.isArray(edit.changes)) {
            throw new Error('Each edit must have a changes array');
        }
        if (!existsSync(edit.file)) {
            throw new Error(`File does not exist: ${edit.file}`);
        }
    }

    const backups: Backup[] = [];
    const modified: string[] = [];

    try {
        // Create backups and apply edits
        for (const edit of edits) {
            const originalContent = readFileSync(edit.file, 'utf-8');
            
            if (atomic) {
                backups.push({
                    file: edit.file,
                    content: originalContent,
                });
            }

            let newContent = originalContent;

            // Apply all changes to this file
            for (const change of edit.changes) {
                if (!change.oldText) {
                    throw new Error('Each change must have oldText property');
                }
                if (change.newText === undefined) {
                    throw new Error('Each change must have newText property');
                }

                const occurrences = (newContent.match(new RegExp(escapeRegex(change.oldText), 'g')) || []).length;
                
                if (occurrences === 0) {
                    throw new Error(`Text not found in ${edit.file}: "${change.oldText.substring(0, 50)}..."`);
                }
                
                if (occurrences > 1) {
                    throw new Error(`Ambiguous replacement in ${edit.file}: "${change.oldText.substring(0, 50)}..." appears ${occurrences} times`);
                }

                newContent = newContent.replace(change.oldText, change.newText);
            }

            writeFileSync(edit.file, newContent, 'utf-8');
            modified.push(edit.file);
        }

        return JSON.stringify({
            success: true,
            filesModified: modified.length,
            files: modified,
        }, null, 2);

    } catch (error: any) {
        // Rollback if atomic mode is enabled
        if (atomic && backups.length > 0) {
            for (const backup of backups) {
                try {
                    writeFileSync(backup.file, backup.content, 'utf-8');
                } catch (rollbackError) {
                    // Best effort rollback
                }
            }
            throw new Error(`Multi-file edit failed and rolled back: ${error.message}`);
        }
        throw new Error(`Multi-file edit failed: ${error.message}`);
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const codingMultiFileEditTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
