import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { fsDeleteDirTool } from './index.js';

describe('fs.delete_dir', () => {
    const testDir = join(process.cwd(), 'test-delete-dir-temp');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        mkdirSync(join(testDir, 'subdir'), { recursive: true });
        writeFileSync(join(testDir, 'file.txt'), 'content');
        writeFileSync(join(testDir, 'subdir', 'nested.txt'), 'nested');
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('should delete directory and all contents', async () => {
        const result = await fsDeleteDirTool.execute({ path: testDir });
        
        expect(result).toContain('deleted successfully');
        expect(existsSync(testDir)).toBe(false);
    });

    it('should delete empty directory', async () => {
        const emptyDir = join(testDir, 'empty');
        mkdirSync(emptyDir);
        
        const result = await fsDeleteDirTool.execute({ path: emptyDir });
        
        expect(result).toContain('deleted successfully');
        expect(existsSync(emptyDir)).toBe(false);
    });

    it('should throw error if path does not exist', async () => {
        await expect(fsDeleteDirTool.execute({ path: '/nonexistent/path' }))
            .rejects.toThrow('does not exist');
    });

    it('should throw error if path is not a directory', async () => {
        const filePath = join(testDir, 'file.txt');
        
        await expect(fsDeleteDirTool.execute({ path: filePath }))
            .rejects.toThrow('not a directory');
    });

    it('should throw error if path is missing', async () => {
        await expect(fsDeleteDirTool.execute({}))
            .rejects.toThrow('path is required');
    });
});
