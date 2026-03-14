import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fsBatchReadTool } from './index.js';

describe('fs.batch_read', () => {
    const testDir = join(process.cwd(), 'test-batch-read-temp');
    const file1 = join(testDir, 'file1.txt');
    const file2 = join(testDir, 'file2.txt');
    const file3 = join(testDir, 'file3.txt');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        writeFileSync(file1, 'content1');
        writeFileSync(file2, 'content2');
        writeFileSync(file3, 'content3');
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should read multiple files successfully', async () => {
        const result = await fsBatchReadTool.execute({ paths: [file1, file2, file3] });
        const parsed = JSON.parse(result);
        
        expect(parsed.total).toBe(3);
        expect(parsed.success).toBe(3);
        expect(parsed.failed).toBe(0);
        expect(parsed.results[0].content).toBe('content1');
        expect(parsed.results[1].content).toBe('content2');
        expect(parsed.results[2].content).toBe('content3');
    });

    it('should continue on error by default', async () => {
        const result = await fsBatchReadTool.execute({ 
            paths: [file1, '/nonexistent/file.txt', file2] 
        });
        const parsed = JSON.parse(result);
        
        expect(parsed.total).toBe(3);
        expect(parsed.success).toBe(2);
        expect(parsed.failed).toBe(1);
        expect(parsed.results[0].success).toBe(true);
        expect(parsed.results[1].success).toBe(false);
        expect(parsed.results[2].success).toBe(true);
    });

    it('should stop on first error when continueOnError is false', async () => {
        await expect(fsBatchReadTool.execute({ 
            paths: [file1, '/nonexistent/file.txt', file2],
            continueOnError: false
        })).rejects.toThrow('Failed to read file');
    });

    it('should throw error if paths is empty', async () => {
        await expect(fsBatchReadTool.execute({ paths: [] }))
            .rejects.toThrow('must not be empty');
    });

    it('should throw error if paths is missing', async () => {
        await expect(fsBatchReadTool.execute({}))
            .rejects.toThrow('required');
    });

    it('should respect encoding parameter', async () => {
        const result = await fsBatchReadTool.execute({ 
            paths: [file1], 
            encoding: 'utf-8' 
        });
        const parsed = JSON.parse(result);
        
        expect(parsed.results[0].content).toBe('content1');
    });
});
