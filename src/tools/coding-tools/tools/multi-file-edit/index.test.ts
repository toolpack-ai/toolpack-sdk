import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingMultiFileEditTool } from './index.js';

describe('coding.multi_file_edit', () => {
    const testDir = join(process.cwd(), 'test-multi-file-edit-temp');
    const file1 = join(testDir, 'file1.ts');
    const file2 = join(testDir, 'file2.ts');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        writeFileSync(file1, 'const oldValue = 1;');
        writeFileSync(file2, 'const oldValue = 2;');
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should edit multiple files successfully', async () => {
        const result = await codingMultiFileEditTool.execute({
            edits: [
                {
                    file: file1,
                    changes: [{ oldText: 'oldValue', newText: 'newValue' }],
                },
                {
                    file: file2,
                    changes: [{ oldText: 'oldValue', newText: 'newValue' }],
                },
            ],
        });
        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(true);
        expect(parsed.filesModified).toBe(2);
        expect(readFileSync(file1, 'utf-8')).toContain('newValue');
        expect(readFileSync(file2, 'utf-8')).toContain('newValue');
    });

    it('should apply multiple changes to a single file', async () => {
        writeFileSync(file1, 'const a = 1; const b = 2;');
        
        const result = await codingMultiFileEditTool.execute({
            edits: [
                {
                    file: file1,
                    changes: [
                        { oldText: 'a = 1', newText: 'a = 10' },
                        { oldText: 'b = 2', newText: 'b = 20' },
                    ],
                },
            ],
        });
        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(true);
        const content = readFileSync(file1, 'utf-8');
        expect(content).toContain('a = 10');
        expect(content).toContain('b = 20');
    });

    it('should rollback on failure in atomic mode', async () => {
        const original1 = readFileSync(file1, 'utf-8');
        const original2 = readFileSync(file2, 'utf-8');

        await expect(codingMultiFileEditTool.execute({
            edits: [
                {
                    file: file1,
                    changes: [{ oldText: 'oldValue', newText: 'newValue' }],
                },
                {
                    file: file2,
                    changes: [{ oldText: 'nonexistent', newText: 'newValue' }],
                },
            ],
            atomic: true,
        })).rejects.toThrow('rolled back');

        expect(readFileSync(file1, 'utf-8')).toBe(original1);
        expect(readFileSync(file2, 'utf-8')).toBe(original2);
    });

    it('should throw error for ambiguous replacements', async () => {
        writeFileSync(file1, 'const x = 1; const x = 2;');

        await expect(codingMultiFileEditTool.execute({
            edits: [
                {
                    file: file1,
                    changes: [{ oldText: 'const x', newText: 'let x' }],
                },
            ],
        })).rejects.toThrow('Ambiguous replacement');
    });

    it('should throw error if edits array is empty', async () => {
        await expect(codingMultiFileEditTool.execute({ edits: [] }))
            .rejects.toThrow('must not be empty');
    });

    it('should throw error if file does not exist', async () => {
        await expect(codingMultiFileEditTool.execute({
            edits: [
                {
                    file: '/nonexistent/file.ts',
                    changes: [{ oldText: 'old', newText: 'new' }],
                },
            ],
        })).rejects.toThrow('does not exist');
    });
});
