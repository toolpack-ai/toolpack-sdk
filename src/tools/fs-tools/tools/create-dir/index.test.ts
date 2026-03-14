import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsCreateDirTool } from './index.js';

describe('fs.create_dir tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-create-dir-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsCreateDirTool.name).toBe('fs.create_dir');
        expect(fsCreateDirTool.category).toBe('filesystem');
    });

    it('should create a directory', async () => {
        const dirPath = path.join(tmpDir, 'newdir');
        await fsCreateDirTool.execute({ path: dirPath });
        expect(fs.existsSync(dirPath)).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
        const dirPath = path.join(tmpDir, 'a', 'b', 'c');
        await fsCreateDirTool.execute({ path: dirPath });
        expect(fs.existsSync(dirPath)).toBe(true);
    });

    it('should return message if directory already exists', async () => {
        const result = await fsCreateDirTool.execute({ path: tmpDir });
        expect(result).toContain('already exists');
    });

    it('should throw if path exists but is a file', async () => {
        const filePath = path.join(tmpDir, 'file.txt');
        fs.writeFileSync(filePath, 'data', 'utf-8');
        await expect(fsCreateDirTool.execute({ path: filePath })).rejects.toThrow('not a directory');
    });

    it('should throw if path is missing', async () => {
        await expect(fsCreateDirTool.execute({})).rejects.toThrow('path is required');
    });
});
