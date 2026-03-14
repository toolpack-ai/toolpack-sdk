import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingGoToDefinitionTool } from './index.js';

describe('coding.go_to_definition', () => {
    const testDir = join(process.cwd(), 'test-go-to-definition-temp');
    const testFile = join(testDir, 'test.ts');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        
        writeFileSync(testFile, `
function myFunction() {
    return 'hello';
}

const result = myFunction();
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should find definition in the same file', async () => {
        const result = await codingGoToDefinitionTool.execute({
            file: testFile,
            line: 6,
            column: 15,
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(true);
        expect(parsed.symbol).toBe('myFunction');
        expect(parsed.definition).toBeDefined();
        expect(parsed.definition.kind).toBe('function');
    });

    it('should return not found for undefined symbols', async () => {
        const result = await codingGoToDefinitionTool.execute({
            file: testFile,
            line: 1,
            column: 0,
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(false);
    });

    it('should include file, line, and column in definition', async () => {
        const result = await codingGoToDefinitionTool.execute({
            file: testFile,
            line: 6,
            column: 15,
        });
        const parsed = JSON.parse(result);

        if (parsed.found) {
            expect(parsed.definition).toHaveProperty('file');
            expect(parsed.definition).toHaveProperty('line');
            expect(parsed.definition).toHaveProperty('column');
        }
    });

    it('should throw error if file is missing', async () => {
        await expect(codingGoToDefinitionTool.execute({ line: 1, column: 0 }))
            .rejects.toThrow('file is required');
    });

    it('should throw error if line is missing', async () => {
        await expect(codingGoToDefinitionTool.execute({ file: testFile, column: 0 }))
            .rejects.toThrow('line is required');
    });

    it('should throw error if column is missing', async () => {
        await expect(codingGoToDefinitionTool.execute({ file: testFile, line: 1 }))
            .rejects.toThrow('column is required');
    });
});
