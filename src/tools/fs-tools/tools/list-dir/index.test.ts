import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsListDirTool } from './index.js';

describe('fs.list_dir tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-list-dir-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsListDirTool.name).toBe('fs.list_dir');
        expect(fsListDirTool.category).toBe('filesystem');
    });

    it('should list files in a directory', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b', 'utf-8');
        const result = JSON.parse(await fsListDirTool.execute({ path: tmpDir }));
        expect(result).toHaveLength(2);
        expect(result.map((e: any) => e.name).sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('should list recursively', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sub'));
        fs.writeFileSync(path.join(tmpDir, 'sub', 'deep.txt'), 'deep', 'utf-8');
        const result = JSON.parse(await fsListDirTool.execute({ path: tmpDir, recursive: true }));
        const names = result.map((e: any) => e.name);
        expect(names).toContain('sub');
        expect(names).toContain('sub/deep.txt');
    });

    it('should return empty for empty directory', async () => {
        const result = JSON.parse(await fsListDirTool.execute({ path: tmpDir }));
        expect(result).toHaveLength(0);
    });

    it('should throw if path not found', async () => {
        await expect(fsListDirTool.execute({ path: path.join(tmpDir, 'nope') })).rejects.toThrow('Directory not found');
    });

    it('should throw if path is a file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'data', 'utf-8');
        await expect(fsListDirTool.execute({ path: filePath })).rejects.toThrow('Path is not a directory');
    });

    it('should throw if path is missing', async () => {
        await expect(fsListDirTool.execute({})).rejects.toThrow('path is required');
    });
});
