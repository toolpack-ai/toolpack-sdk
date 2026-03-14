import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingRefactorRenameTool } from './index.js';

describe('coding.refactor_rename', () => {
    const testDir = join(process.cwd(), 'test-refactor-rename-temp');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        
        writeFileSync(join(testDir, 'file1.ts'), `
function oldName() {
    return oldName;
}
        `);

        writeFileSync(join(testDir, 'file2.ts'), `
const x = oldName();
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should rename symbol across multiple files', async () => {
        const result = await codingRefactorRenameTool.execute({
            symbol: 'oldName',
            newName: 'newName',
            path: testDir,
        });
        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(true);
        expect(parsed.filesAffected).toBeGreaterThan(0);
        expect(parsed.totalOccurrences).toBeGreaterThan(0);
        
        const file1Content = readFileSync(join(testDir, 'file1.ts'), 'utf-8');
        expect(file1Content).toContain('newName');
        expect(file1Content).not.toContain('oldName');
    });

    it('should support dry run mode', async () => {
        const original = readFileSync(join(testDir, 'file1.ts'), 'utf-8');
        
        const result = await codingRefactorRenameTool.execute({
            symbol: 'oldName',
            newName: 'newName',
            path: testDir,
            dryRun: true,
        });
        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(true);
        expect(parsed.dryRun).toBe(true);
        expect(parsed.totalOccurrences).toBeGreaterThan(0);
        
        const afterContent = readFileSync(join(testDir, 'file1.ts'), 'utf-8');
        expect(afterContent).toBe(original);
    });

    it('should report all affected files and occurrences', async () => {
        const result = await codingRefactorRenameTool.execute({
            symbol: 'oldName',
            newName: 'newName',
            path: testDir,
        });
        const parsed = JSON.parse(result);

        expect(parsed).toHaveProperty('filesAffected');
        expect(parsed).toHaveProperty('totalOccurrences');
        expect(parsed).toHaveProperty('changes');
        expect(parsed.changes).toBeInstanceOf(Array);
    });

    it('should throw error if symbol is missing', async () => {
        await expect(codingRefactorRenameTool.execute({ 
            newName: 'newName', 
            path: testDir 
        })).rejects.toThrow('symbol is required');
    });

    it('should throw error if newName is missing', async () => {
        await expect(codingRefactorRenameTool.execute({ 
            symbol: 'oldName', 
            path: testDir 
        })).rejects.toThrow('newName is required');
    });

    it('should throw error if path is missing', async () => {
        await expect(codingRefactorRenameTool.execute({ 
            symbol: 'oldName', 
            newName: 'newName' 
        })).rejects.toThrow('path is required');
    });

    it('should throw error if old and new names are the same', async () => {
        await expect(codingRefactorRenameTool.execute({
            symbol: 'oldName',
            newName: 'oldName',
            path: testDir,
        })).rejects.toThrow('must be different');
    });
});
