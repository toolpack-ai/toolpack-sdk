import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsWriteFileTool } from './index.js';

describe('fs.write_file tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-write-file-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsWriteFileTool.name).toBe('fs.write_file');
        expect(fsWriteFileTool.category).toBe('filesystem');
        expect(fsWriteFileTool.parameters.required).toContain('path');
        expect(fsWriteFileTool.parameters.required).toContain('content');
    });

    it('should write content to a new file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        await fsWriteFileTool.execute({ path: filePath, content: 'hello' });
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
    });

    it('should create parent directories', async () => {
        const filePath = path.join(tmpDir, 'a', 'b', 'c.txt');
        await fsWriteFileTool.execute({ path: filePath, content: 'deep' });
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('deep');
    });

    it('should overwrite existing file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'old', 'utf-8');
        await fsWriteFileTool.execute({ path: filePath, content: 'new' });
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('new');
    });

    it('should throw if path is missing', async () => {
        await expect(fsWriteFileTool.execute({ content: 'x' })).rejects.toThrow('path is required');
    });

    it('should throw if content is missing', async () => {
        await expect(fsWriteFileTool.execute({ path: '/tmp/x' })).rejects.toThrow('content is required');
    });
});
