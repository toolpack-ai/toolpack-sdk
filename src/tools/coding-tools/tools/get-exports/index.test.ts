import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingGetExportsTool } from './index.js';

describe('coding.get_exports', () => {
    const testDir = join(process.cwd(), 'test-get-exports-temp');
    const testFile = join(testDir, 'test.js');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });

        writeFileSync(testFile, `
export function myFunction() {
    return 'hello';
}

export class MyClass {}

export const myConst = 'value';

const internalVar = 'internal';

export default function defaultFunction() {}
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should list all exported symbols', async () => {
        const result = await codingGetExportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        expect(parsed.exports).toBeDefined();
        expect(parsed.exports).toBeInstanceOf(Array);

        const names = parsed.exports.map((e: any) => e.name);
        expect(names).toContain('myFunction');
        expect(names).toContain('MyClass');
        expect(names).toContain('myConst');
        expect(names).toContain('defaultFunction');
        expect(names).not.toContain('internalVar');
    });

    it('should throw error if file is missing', async () => {
        await expect(codingGetExportsTool.execute({}))
            .rejects.toThrow('file is required');
    });

    it('should throw error for invalid file', async () => {
        await expect(codingGetExportsTool.execute({ file: '/nonexistent/file.js' }))
            .rejects.toThrow();
    });
});
