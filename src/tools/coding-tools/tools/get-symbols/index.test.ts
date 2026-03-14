import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingGetSymbolsTool } from './index.js';

describe('coding.get_symbols', () => {
    const testDir = join(process.cwd(), 'test-get-symbols-temp');
    const testFile = join(testDir, 'test.ts');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        
        writeFileSync(testFile, `
export function myFunction() {
    return 'hello';
}

export class MyClass {
    constructor() {}
}

const myConst = 'value';
let myLet = 123;

interface MyInterface {
    name: string;
}

type MyType = {
    id: number;
};
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should list all symbols in a file', async () => {
        const result = await codingGetSymbolsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        expect(parsed.count).toBeGreaterThan(0);
        expect(parsed.symbols).toBeInstanceOf(Array);
    });

    it('should find functions', async () => {
        const result = await codingGetSymbolsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const functions = parsed.symbols.filter((s: any) => s.kind === 'function');
        expect(functions.length).toBeGreaterThan(0);
        expect(functions.some((s: any) => s.name === 'myFunction')).toBe(true);
    });

    it('should find classes', async () => {
        const result = await codingGetSymbolsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const classes = parsed.symbols.filter((s: any) => s.kind === 'class');
        expect(classes.length).toBeGreaterThan(0);
        expect(classes.some((s: any) => s.name === 'MyClass')).toBe(true);
    });

    it('should find variables', async () => {
        const result = await codingGetSymbolsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const variables = parsed.symbols.filter((s: any) => s.kind === 'const' || s.kind === 'let');
        expect(variables.length).toBeGreaterThan(0);
    });

    it('should find interfaces', async () => {
        const result = await codingGetSymbolsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const interfaces = parsed.symbols.filter((s: any) => s.kind === 'interface');
        expect(interfaces.length).toBeGreaterThan(0);
        expect(interfaces.some((s: any) => s.name === 'MyInterface')).toBe(true);
    });

    it('should find type aliases', async () => {
        const result = await codingGetSymbolsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const types = parsed.symbols.filter((s: any) => s.kind === 'type');
        expect(types.length).toBeGreaterThan(0);
        expect(types.some((s: any) => s.name === 'MyType')).toBe(true);
    });

    it('should filter by kind', async () => {
        const result = await codingGetSymbolsTool.execute({ 
            file: testFile,
            kind: 'function'
        });
        const parsed = JSON.parse(result);

        expect(parsed.symbols.every((s: any) => s.kind === 'function')).toBe(true);
    });

    it('should include line and column information', async () => {
        const result = await codingGetSymbolsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        expect(parsed.symbols[0]).toHaveProperty('line');
        expect(parsed.symbols[0]).toHaveProperty('column');
        expect(parsed.symbols[0].line).toBeGreaterThan(0);
    });

    it('should throw error if file is missing', async () => {
        await expect(codingGetSymbolsTool.execute({}))
            .rejects.toThrow('file is required');
    });

    it('should throw error for invalid file', async () => {
        await expect(codingGetSymbolsTool.execute({ file: '/nonexistent/file.ts' }))
            .rejects.toThrow();
    });
});
