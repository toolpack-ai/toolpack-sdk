import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsReadFileTool } from './index.js';

describe('fs.read_file tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-read-file-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsReadFileTool.name).toBe('fs.read_file');
        expect(fsReadFileTool.category).toBe('filesystem');
        expect(fsReadFileTool.parameters.required).toContain('path');
    });

    it('should read a text file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'hello world', 'utf-8');
        const result = await fsReadFileTool.execute({ path: filePath });
        expect(result).toBe('hello world');
    });

    it('should throw if path is missing', async () => {
        await expect(fsReadFileTool.execute({})).rejects.toThrow('path is required');
    });

    it('should throw if file does not exist', async () => {
        await expect(fsReadFileTool.execute({ path: path.join(tmpDir, 'nope.txt') })).rejects.toThrow('File not found');
    });

    it('should throw if path is a directory', async () => {
        await expect(fsReadFileTool.execute({ path: tmpDir })).rejects.toThrow('Path is a directory');
    });
});
