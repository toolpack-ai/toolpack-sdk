import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fsGlobTool } from './index.js';

describe('fs.glob', () => {
    const testDir = join(process.cwd(), 'test-glob-temp');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        mkdirSync(join(testDir, 'src'), { recursive: true });
        mkdirSync(join(testDir, 'dist'), { recursive: true });
        writeFileSync(join(testDir, 'file1.ts'), 'content1');
        writeFileSync(join(testDir, 'file2.js'), 'content2');
        writeFileSync(join(testDir, 'src', 'index.ts'), 'content3');
        writeFileSync(join(testDir, 'src', 'utils.ts'), 'content4');
        writeFileSync(join(testDir, 'dist', 'bundle.js'), 'content5');
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should find files matching pattern', async () => {
        const result = await fsGlobTool.execute({ pattern: '**/*.ts', cwd: testDir });
        const parsed = JSON.parse(result);
        
        expect(parsed.count).toBeGreaterThan(0);
        expect(parsed.files).toContain('file1.ts');
        expect(parsed.files).toContain('src/index.ts');
        expect(parsed.files).toContain('src/utils.ts');
    });

    it('should respect ignore patterns', async () => {
        const result = await fsGlobTool.execute({ 
            pattern: '**/*.ts', 
            cwd: testDir,
            ignore: ['src/**']
        });
        const parsed = JSON.parse(result);
        
        expect(parsed.files).toContain('file1.ts');
        expect(parsed.files).not.toContain('src/index.ts');
    });

    it('should return absolute paths when requested', async () => {
        const result = await fsGlobTool.execute({ 
            pattern: '*.ts', 
            cwd: testDir,
            absolute: true
        });
        const parsed = JSON.parse(result);
        
        expect(parsed.files[0]).toContain(testDir);
    });

    it('should find only files by default', async () => {
        const result = await fsGlobTool.execute({ pattern: '**/*', cwd: testDir });
        const parsed = JSON.parse(result);
        
        expect(parsed.files.every((f: string) => !f.endsWith('/'))).toBe(true);
    });

    it('should find only directories when requested', async () => {
        const result = await fsGlobTool.execute({ 
            pattern: '**/*', 
            cwd: testDir,
            onlyDirectories: true,
            onlyFiles: false
        });
        const parsed = JSON.parse(result);
        
        expect(parsed.count).toBeGreaterThan(0);
    });

    it('should throw error if pattern is missing', async () => {
        await expect(fsGlobTool.execute({})).rejects.toThrow('pattern is required');
    });

    it('should handle non-matching patterns', async () => {
        const result = await fsGlobTool.execute({ 
            pattern: '**/*.xyz', 
            cwd: testDir
        });
        const parsed = JSON.parse(result);
        
        expect(parsed.count).toBe(0);
        expect(parsed.files).toEqual([]);
    });
});
