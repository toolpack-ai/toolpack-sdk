import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsTreeTool } from './index.js';

describe('fs.tree tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-tree-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsTreeTool.name).toBe('fs.tree');
        expect(fsTreeTool.category).toBe('filesystem');
    });

    it('should show tree structure', async () => {
        fs.mkdirSync(path.join(tmpDir, 'src'));
        fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'README.md'), '', 'utf-8');
        const result = await fsTreeTool.execute({ path: tmpDir });
        expect(result).toContain('src/');
        expect(result).toContain('index.ts');
        expect(result).toContain('README.md');
        expect(result).toContain('├──');
    });

    it('should respect depth limit', async () => {
        fs.mkdirSync(path.join(tmpDir, 'a', 'b', 'c'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'a', 'b', 'c', 'deep.txt'), '', 'utf-8');
        const result = await fsTreeTool.execute({ path: tmpDir, depth: 1 });
        expect(result).toContain('a/');
        expect(result).not.toContain('deep.txt');
    });

    it('should show empty directory', async () => {
        const result = await fsTreeTool.execute({ path: tmpDir });
        const lines = result.split('\n');
        expect(lines).toHaveLength(1); // just the root dir name
    });

    it('should throw if path not found', async () => {
        await expect(fsTreeTool.execute({ path: path.join(tmpDir, 'nope') })).rejects.toThrow('Directory not found');
    });

    it('should throw if path is missing', async () => {
        await expect(fsTreeTool.execute({})).rejects.toThrow('path is required');
    });
});
