import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { fsBatchWriteTool } from './index.js';

describe('fs.batch_write', () => {
    const testDir = join(process.cwd(), 'test-batch-write-temp');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should write multiple files successfully', async () => {
        const files = [
            { path: join(testDir, 'file1.txt'), content: 'content1' },
            { path: join(testDir, 'file2.txt'), content: 'content2' },
            { path: join(testDir, 'file3.txt'), content: 'content3' },
        ];
        
        const result = await fsBatchWriteTool.execute({ files });
        const parsed = JSON.parse(result);
        
        expect(parsed.success).toBe(true);
        expect(parsed.written).toBe(3);
        expect(readFileSync(join(testDir, 'file1.txt'), 'utf-8')).toBe('content1');
        expect(readFileSync(join(testDir, 'file2.txt'), 'utf-8')).toBe('content2');
        expect(readFileSync(join(testDir, 'file3.txt'), 'utf-8')).toBe('content3');
    });

    it('should create parent directories when createDirs is true', async () => {
        const files = [
            { path: join(testDir, 'nested', 'deep', 'file.txt'), content: 'nested content' },
        ];
        
        const result = await fsBatchWriteTool.execute({ files, createDirs: true });
        const parsed = JSON.parse(result);
        
        expect(parsed.success).toBe(true);
        expect(existsSync(join(testDir, 'nested', 'deep', 'file.txt'))).toBe(true);
    });

    it('should rollback on failure in atomic mode', async () => {
        const file1 = join(testDir, 'existing.txt');
        writeFileSync(file1, 'original');
        
        const files = [
            { path: file1, content: 'modified' },
            { path: '/invalid/path/file.txt', content: 'will fail' },
        ];
        
        await expect(fsBatchWriteTool.execute({ files, atomic: true }))
            .rejects.toThrow('rolled back');
        
        expect(readFileSync(file1, 'utf-8')).toBe('original');
    });

    it('should overwrite existing files', async () => {
        const filePath = join(testDir, 'overwrite.txt');
        writeFileSync(filePath, 'original');
        
        const files = [{ path: filePath, content: 'new content' }];
        await fsBatchWriteTool.execute({ files });
        
        expect(readFileSync(filePath, 'utf-8')).toBe('new content');
    });

    it('should throw error if files array is empty', async () => {
        await expect(fsBatchWriteTool.execute({ files: [] }))
            .rejects.toThrow('must not be empty');
    });

    it('should throw error if files is missing', async () => {
        await expect(fsBatchWriteTool.execute({}))
            .rejects.toThrow('required');
    });

    it('should throw error if file object is invalid', async () => {
        await expect(fsBatchWriteTool.execute({ files: [{ path: 'test.txt' }] }))
            .rejects.toThrow('must have path and content');
    });
});
