import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingGetDiagnosticsTool } from './index.js';

describe('coding.get_diagnostics', () => {
    const testDir = join(process.cwd(), 'test-get-diagnostics-temp');
    const validFile = join(testDir, 'valid.js');
    const invalidFile = join(testDir, 'invalid.js');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });

        writeFileSync(validFile, `
function myValidFunction() {
    return 42;
}
        `);

        writeFileSync(invalidFile, `
function myInvalidFunction() {
    return 42
}
var class = "reserved word syntax error";
// unclosed bracket
function errorHere() {
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should return no diagnostics for a valid file', async () => {
        const result = await codingGetDiagnosticsTool.execute({ file: validFile });
        const parsed = JSON.parse(result);

        expect(parsed.diagnostics).toBeDefined();
        expect(parsed.diagnostics.length).toBe(0);
    });

    it('should return diagnostics for an invalid file', async () => {
        const result = await codingGetDiagnosticsTool.execute({ file: invalidFile });
        const parsed = JSON.parse(result);

        expect(parsed.diagnostics).toBeDefined();
        expect(parsed.diagnostics.length).toBeGreaterThan(0);
    });

    it('should throw error if file is missing', async () => {
        await expect(codingGetDiagnosticsTool.execute({}))
            .rejects.toThrow('file is required');
    });

    it('should throw error for invalid file path', async () => {
        await expect(codingGetDiagnosticsTool.execute({ file: '/nonexistent/file.js' }))
            .rejects.toThrow();
    });
});
