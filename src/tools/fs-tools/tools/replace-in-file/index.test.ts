import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsReplaceInFileTool } from './index.js';

describe('fs.replace_in_file tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-replace-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsReplaceInFileTool.name).toBe('fs.replace_in_file');
        expect(fsReplaceInFileTool.category).toBe('filesystem');
    });

    it('should replace text in a file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'hello world hello', 'utf-8');
        const result = await fsReplaceInFileTool.execute({ path: filePath, search: 'hello', replace: 'hi' });
        expect(result).toContain('2 occurrence(s)');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('hi world hi');
    });

    it('should report no occurrences', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'hello world', 'utf-8');
        const result = await fsReplaceInFileTool.execute({ path: filePath, search: 'zzz', replace: 'x' });
        expect(result).toContain('No occurrences');
    });

    it('should allow replacing with empty string', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'remove_this_part', 'utf-8');
        await fsReplaceInFileTool.execute({ path: filePath, search: '_this', replace: '' });
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('remove_part');
    });

    it('should throw if file not found', async () => {
        await expect(fsReplaceInFileTool.execute({ path: path.join(tmpDir, 'nope'), search: 'a', replace: 'b' })).rejects.toThrow('File not found');
    });

    it('should throw if path is missing', async () => {
        await expect(fsReplaceInFileTool.execute({ search: 'a', replace: 'b' })).rejects.toThrow('path is required');
    });

    it('should throw if search is missing', async () => {
        await expect(fsReplaceInFileTool.execute({ path: '/tmp/x', replace: 'b' })).rejects.toThrow('search is required');
    });
});
