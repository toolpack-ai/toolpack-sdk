import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsAppendFileTool } from './index.js';

describe('fs.append_file tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-append-file-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsAppendFileTool.name).toBe('fs.append_file');
        expect(fsAppendFileTool.category).toBe('filesystem');
    });

    it('should append to an existing file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'hello', 'utf-8');
        await fsAppendFileTool.execute({ path: filePath, content: ' world' });
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
    });

    it('should create file if it does not exist', async () => {
        const filePath = path.join(tmpDir, 'new.txt');
        await fsAppendFileTool.execute({ path: filePath, content: 'created' });
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('created');
    });

    it('should create parent directories', async () => {
        const filePath = path.join(tmpDir, 'a', 'b', 'c.txt');
        await fsAppendFileTool.execute({ path: filePath, content: 'deep' });
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('deep');
    });

    it('should throw if path is missing', async () => {
        await expect(fsAppendFileTool.execute({ content: 'x' })).rejects.toThrow('path is required');
    });

    it('should throw if content is missing', async () => {
        await expect(fsAppendFileTool.execute({ path: '/tmp/x' })).rejects.toThrow('content is required');
    });
});
