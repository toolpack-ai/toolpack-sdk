import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsDeleteFileTool } from './index.js';

describe('fs.delete_file tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-delete-file-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsDeleteFileTool.name).toBe('fs.delete_file');
        expect(fsDeleteFileTool.category).toBe('filesystem');
    });

    it('should delete an existing file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'data', 'utf-8');
        await fsDeleteFileTool.execute({ path: filePath });
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should throw if file does not exist', async () => {
        await expect(fsDeleteFileTool.execute({ path: path.join(tmpDir, 'nope.txt') })).rejects.toThrow('File not found');
    });

    it('should throw if path is a directory', async () => {
        await expect(fsDeleteFileTool.execute({ path: tmpDir })).rejects.toThrow('Path is a directory');
    });

    it('should throw if path is missing', async () => {
        await expect(fsDeleteFileTool.execute({})).rejects.toThrow('path is required');
    });
});
