import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsSearchTool } from './index.js';

describe('fs.search tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-search-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsSearchTool.name).toBe('fs.search');
        expect(fsSearchTool.category).toBe('filesystem');
    });

    it('should find matching lines', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world\nfoo bar\nhello again', 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'hello' });
        const matches = JSON.parse(result);
        expect(matches).toHaveLength(2);
        expect(matches[0].line).toBe(1);
        expect(matches[1].line).toBe(3);
    });

    it('should search recursively by default', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sub'));
        fs.writeFileSync(path.join(tmpDir, 'sub', 'deep.txt'), 'target line', 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'target' });
        const matches = JSON.parse(result);
        expect(matches).toHaveLength(1);
        expect(matches[0].file).toContain('deep.txt');
    });

    it('should not recurse when recursive=false', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sub'));
        fs.writeFileSync(path.join(tmpDir, 'sub', 'deep.txt'), 'target line', 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'target', recursive: false });
        expect(result).toContain('No matches found');
    });

    it('should respect max_results', async () => {
        let content = '';
        for (let i = 0; i < 100; i++) content += `match line ${i}\n`;
        fs.writeFileSync(path.join(tmpDir, 'big.txt'), content, 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'match', max_results: 5 });
        const matches = JSON.parse(result.split('\n(results capped')[0]);
        expect(matches).toHaveLength(5);
    });

    it('should return no-match message when nothing found', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'nothing here', 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'zzzzz' });
        expect(result).toContain('No matches found');
    });

    it('should handle regex searches correctly', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'version 1.2.3\nversion 2.0.0\nno version here', 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'version \\d+\\.\\d+\\.\\d+', regex: true });
        const matches = JSON.parse(result);
        expect(matches).toHaveLength(2);
        expect(matches[0].content).toBe('version 1.2.3');
        expect(matches[1].content).toBe('version 2.0.0');
    });

    it('should default to case-insensitive search', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'Hello World\nhello world\nHELLO WORLD', 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'hello' });
        const matches = JSON.parse(result);
        expect(matches).toHaveLength(3);
    });

    it('should respect case_sensitive flag', async () => {
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'Hello World\nhello world\nHELLO WORLD', 'utf-8');
        const result = await fsSearchTool.execute({ path: tmpDir, query: 'Hello', case_sensitive: true });
        const matches = JSON.parse(result);
        expect(matches).toHaveLength(1);
        expect(matches[0].content).toBe('Hello World');
    });

    it('should throw if path is missing', async () => {
        await expect(fsSearchTool.execute({ query: 'x' })).rejects.toThrow('path is required');
    });

    it('should throw if query is missing', async () => {
        await expect(fsSearchTool.execute({ path: tmpDir })).rejects.toThrow('query is required');
    });
});
