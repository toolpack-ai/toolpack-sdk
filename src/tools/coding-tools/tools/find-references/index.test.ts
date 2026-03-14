import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingFindReferencesTool } from './index.js';

describe('coding.find_references', () => {
    const testDir = join(process.cwd(), 'test-find-references-temp');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        
        writeFileSync(join(testDir, 'definition.ts'), `
export function myFunction() {
    return 'hello';
}
        `);

        writeFileSync(join(testDir, 'usage.ts'), `
import { myFunction } from './definition';

const result = myFunction();
const fn = myFunction;
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should find all references to a symbol', async () => {
        const result = await codingFindReferencesTool.execute({
            symbol: 'myFunction',
            path: testDir,
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBeGreaterThan(0);
        expect(parsed.references).toBeInstanceOf(Array);
    });

    it('should exclude declarations by default', async () => {
        const result = await codingFindReferencesTool.execute({
            symbol: 'myFunction',
            path: join(testDir, 'definition.ts'),
        });
        const parsed = JSON.parse(result);

        expect(parsed.references.every((r: any) => !r.isDeclaration)).toBe(true);
    });

    it('should include declarations when requested', async () => {
        const result = await codingFindReferencesTool.execute({
            symbol: 'myFunction',
            path: join(testDir, 'definition.ts'),
            includeDeclaration: true,
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBeGreaterThan(0);
    });

    it('should include context for each reference', async () => {
        const result = await codingFindReferencesTool.execute({
            symbol: 'myFunction',
            path: testDir,
        });
        const parsed = JSON.parse(result);

        if (parsed.references.length > 0) {
            expect(parsed.references[0]).toHaveProperty('context');
            expect(parsed.references[0]).toHaveProperty('line');
            expect(parsed.references[0]).toHaveProperty('column');
        }
    });

    it('should search recursively in directories', async () => {
        const result = await codingFindReferencesTool.execute({
            symbol: 'myFunction',
            path: testDir,
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBeGreaterThan(0);
    });

    it('should throw error if symbol is missing', async () => {
        await expect(codingFindReferencesTool.execute({ path: testDir }))
            .rejects.toThrow('symbol is required');
    });

    it('should throw error if path is missing', async () => {
        await expect(codingFindReferencesTool.execute({ symbol: 'test' }))
            .rejects.toThrow('path is required');
    });
});
