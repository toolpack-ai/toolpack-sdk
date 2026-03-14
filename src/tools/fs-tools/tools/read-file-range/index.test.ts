import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsReadFileRangeTool } from './index.js';

describe('fs.read_file_range tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-read-range-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsReadFileRangeTool.name).toBe('fs.read_file_range');
        expect(fsReadFileRangeTool.category).toBe('filesystem');
    });

    it('should read a range of lines', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8');
        const result = await fsReadFileRangeTool.execute({ path: filePath, start_line: 2, end_line: 4 });
        expect(result).toContain('2: line2');
        expect(result).toContain('3: line3');
        expect(result).toContain('4: line4');
        expect(result).not.toContain('1: line1');
        expect(result).not.toContain('5: line5');
    });

    it('should clamp to file length if end_line exceeds total', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'a\nb\nc', 'utf-8');
        const result = await fsReadFileRangeTool.execute({ path: filePath, start_line: 1, end_line: 100 });
        expect(result).toContain('1: a');
        expect(result).toContain('3: c');
    });

    it('should throw if start_line < 1', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'a', 'utf-8');
        await expect(fsReadFileRangeTool.execute({ path: filePath, start_line: 0, end_line: 1 })).rejects.toThrow('start_line must be >= 1');
    });

    it('should throw if end_line < start_line', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'a', 'utf-8');
        await expect(fsReadFileRangeTool.execute({ path: filePath, start_line: 3, end_line: 1 })).rejects.toThrow('end_line must be >= start_line');
    });

    it('should throw if file not found', async () => {
        await expect(fsReadFileRangeTool.execute({ path: path.join(tmpDir, 'nope'), start_line: 1, end_line: 1 })).rejects.toThrow('File not found');
    });

    it('should throw if path is missing', async () => {
        await expect(fsReadFileRangeTool.execute({ start_line: 1, end_line: 1 })).rejects.toThrow('path is required');
    });
});
