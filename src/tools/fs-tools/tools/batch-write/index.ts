import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

interface FileToWrite {
    path: string;
    content: string;
}

interface FileBackup {
    path: string;
    existed: boolean;
    originalContent?: string;
}

async function execute(args: Record<string, any>): Promise<string> {
    const files = args.files as FileToWrite[];
    const encoding = (args.encoding || 'utf-8') as BufferEncoding;
    const atomic = args.atomic !== false;
    const createDirs = args.createDirs !== false;

    if (!files || !Array.isArray(files) || files.length === 0) {
        throw new Error('files array is required and must not be empty');
    }

    for (const file of files) {
        if (!file.path || file.content === undefined) {
            throw new Error('Each file must have path and content properties');
        }
    }

    const backups: FileBackup[] = [];
    const written: string[] = [];

    try {
        for (const file of files) {
            const absPath = resolve(file.path);
            
            if (atomic) {
                const existed = existsSync(absPath);
                const backup: FileBackup = { path: absPath, existed };
                if (existed) {
                    backup.originalContent = await readFile(absPath, encoding);
                }
                backups.push(backup);
            }

            if (createDirs) {
                const dir = dirname(absPath);
                await mkdir(dir, { recursive: true });
            }

            await writeFile(absPath, file.content, encoding);
            written.push(absPath);
        }

        return JSON.stringify({
            success: true,
            written: written.length,
            files: written,
        }, null, 2);

    } catch (error: any) {
        if (atomic && backups.length > 0) {
            for (const backup of backups) {
                try {
                    if (backup.existed && backup.originalContent !== undefined) {
                        await writeFile(backup.path, backup.originalContent, encoding);
                    } else if (!backup.existed && existsSync(backup.path)) {
                        await unlink(backup.path);
                    }
                } catch (rollbackError) {
                    // Best effort rollback
                }
            }
            throw new Error(`Batch write failed and rolled back: ${error.message}`);
        }
        throw new Error(`Batch write failed: ${error.message}`);
    }
}

export const fsBatchWriteTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
