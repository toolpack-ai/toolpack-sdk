import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsCopyTool } from './index.js';

describe('fs.copy tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-copy-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsCopyTool.name).toBe('fs.copy');
        expect(fsCopyTool.category).toBe('filesystem');
    });

    it('should copy a file', async () => {
        const src = path.join(tmpDir, 'a.txt');
        const dest = path.join(tmpDir, 'b.txt');
        fs.writeFileSync(src, 'data', 'utf-8');
        await fsCopyTool.execute({ path: src, new_path: dest });
        expect(fs.existsSync(src)).toBe(true);
        expect(fs.readFileSync(dest, 'utf-8')).toBe('data');
    });

    it('should copy a directory recursively', async () => {
        const srcDir = path.join(tmpDir, 'srcdir');
        fs.mkdirSync(srcDir);
        fs.writeFileSync(path.join(srcDir, 'f.txt'), 'inside', 'utf-8');
        fs.mkdirSync(path.join(srcDir, 'sub'));
        fs.writeFileSync(path.join(srcDir, 'sub', 'deep.txt'), 'deep', 'utf-8');

        const destDir = path.join(tmpDir, 'destdir');
        await fsCopyTool.execute({ path: srcDir, new_path: destDir });

        expect(fs.existsSync(srcDir)).toBe(true);
        expect(fs.readFileSync(path.join(destDir, 'f.txt'), 'utf-8')).toBe('inside');
        expect(fs.readFileSync(path.join(destDir, 'sub', 'deep.txt'), 'utf-8')).toBe('deep');
    });

    it('should create parent directories of destination', async () => {
        const src = path.join(tmpDir, 'a.txt');
        const dest = path.join(tmpDir, 'x', 'y', 'b.txt');
        fs.writeFileSync(src, 'data', 'utf-8');
        await fsCopyTool.execute({ path: src, new_path: dest });
        expect(fs.readFileSync(dest, 'utf-8')).toBe('data');
    });

    it('should throw if source not found', async () => {
        await expect(fsCopyTool.execute({ path: path.join(tmpDir, 'nope'), new_path: '/tmp/x' })).rejects.toThrow('Source not found');
    });

    it('should throw if path is missing', async () => {
        await expect(fsCopyTool.execute({ new_path: '/tmp/x' })).rejects.toThrow('path is required');
    });

    it('should throw if new_path is missing', async () => {
        await expect(fsCopyTool.execute({ path: '/tmp/x' })).rejects.toThrow('new_path is required');
    });
});
