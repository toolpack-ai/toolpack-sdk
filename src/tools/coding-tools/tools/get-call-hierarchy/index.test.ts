import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingGetCallHierarchyTool } from './index.js';

describe('coding.get_call_hierarchy', () => {
    const testDir = join(process.cwd(), 'test-get-call-hierarchy-temp');
    const testFile = join(testDir, 'test.js');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });

        writeFileSync(testFile, `
function baseFunction() {
    return 42;
}

function callerFunction() {
    return baseFunction();
}
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should throw error if required parameters are missing', async () => {
        await expect(codingGetCallHierarchyTool.execute({ file: testFile }))
            .rejects.toThrow();
    });

    it('should throw error for invalid file', async () => {
        await expect(codingGetCallHierarchyTool.execute({
            file: '/nonexistent/file.js',
            line: 1,
            column: 0
        })).rejects.toThrow();
    });

    it('should not throw if parameters are correct (dummy implementation)', async () => {
        const result = await codingGetCallHierarchyTool.execute({
            file: testFile,
            line: 1,
            column: 9
        });
        const parsed = JSON.parse(result);
        expect(parsed).toBeDefined();
        expect(parsed.file).toBe(testFile);
    });
});
