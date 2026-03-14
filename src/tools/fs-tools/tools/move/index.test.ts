import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsMoveTool } from './index.js';

describe('fs.move tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-move-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsMoveTool.name).toBe('fs.move');
        expect(fsMoveTool.category).toBe('filesystem');
    });

    it('should move a file', async () => {
        const src = path.join(tmpDir, 'a.txt');
        const dest = path.join(tmpDir, 'b.txt');
        fs.writeFileSync(src, 'data', 'utf-8');
        await fsMoveTool.execute({ path: src, new_path: dest });
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(dest, 'utf-8')).toBe('data');
    });

    it('should move a directory', async () => {
        const srcDir = path.join(tmpDir, 'srcdir');
        const destDir = path.join(tmpDir, 'destdir');
        fs.mkdirSync(srcDir);
        fs.writeFileSync(path.join(srcDir, 'f.txt'), 'inside', 'utf-8');
        await fsMoveTool.execute({ path: srcDir, new_path: destDir });
        expect(fs.existsSync(srcDir)).toBe(false);
        expect(fs.readFileSync(path.join(destDir, 'f.txt'), 'utf-8')).toBe('inside');
    });

    it('should create parent directories of destination', async () => {
        const src = path.join(tmpDir, 'a.txt');
        const dest = path.join(tmpDir, 'x', 'y', 'b.txt');
        fs.writeFileSync(src, 'data', 'utf-8');
        await fsMoveTool.execute({ path: src, new_path: dest });
        expect(fs.readFileSync(dest, 'utf-8')).toBe('data');
    });

    it('should throw if source not found', async () => {
        await expect(fsMoveTool.execute({ path: path.join(tmpDir, 'nope'), new_path: '/tmp/x' })).rejects.toThrow('Source not found');
    });

    it('should throw if path is missing', async () => {
        await expect(fsMoveTool.execute({ new_path: '/tmp/x' })).rejects.toThrow('path is required');
    });

    it('should throw if new_path is missing', async () => {
        await expect(fsMoveTool.execute({ path: '/tmp/x' })).rejects.toThrow('new_path is required');
    });
});
