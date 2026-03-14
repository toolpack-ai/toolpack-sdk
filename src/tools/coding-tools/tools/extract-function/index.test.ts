import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingExtractFunctionTool } from './index.js';

describe('coding.extract_function', () => {
    const testDir = join(process.cwd(), 'test-extract-function-temp');
    const testFile = join(testDir, 'test.js');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });

        writeFileSync(testFile, `
function calculateTotal(items) {
    let total = 0;
    for (const item of items) {
        if (item.active) {
            total += item.price * item.quantity;
        }
    }
    return total;
}
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should throw error if required parameters are missing', async () => {
        await expect(codingExtractFunctionTool.execute({ file: testFile }))
            .rejects.toThrow();
    });

    it('should throw error for invalid file', async () => {
        await expect(codingExtractFunctionTool.execute({
            file: '/nonexistent/file.js',
            startLine: 1,
            startColumn: 0,
            endLine: 2,
            endColumn: 0,
            newFunctionName: 'test'
        })).rejects.toThrow();
    });

    it('should not throw if parameters are correct (dummy implementation returns null/empty)', async () => {
        const result = await codingExtractFunctionTool.execute({
            file: testFile,
            startLine: 4,
            startColumn: 8,
            endLine: 6,
            endColumn: 9,
            newFunctionName: 'calculateItemTotal'
        });
        const parsed = JSON.parse(result);
        expect(parsed).toBeDefined();
        expect(parsed.file).toBe(testFile);
    });
});
