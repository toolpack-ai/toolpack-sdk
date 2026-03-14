import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingFindSymbolTool } from './index.js';

describe('coding.find_symbol', () => {
    const testDir = join(process.cwd(), 'test-find-symbol-temp');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        
        // Create test files with various symbols
        writeFileSync(join(testDir, 'functions.ts'), `
export function myFunction() {
    return 'hello';
}

function helperFunction() {
    return 42;
}
        `);

        writeFileSync(join(testDir, 'classes.ts'), `
export class MyClass {
    constructor() {}
}

class HelperClass {
    method() {}
}
        `);

        writeFileSync(join(testDir, 'variables.ts'), `
const myConst = 'value';
let myLet = 123;
var myVar = true;
        `);

        writeFileSync(join(testDir, 'types.ts'), `
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

    it('should find function declarations', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'myFunction',
            path: join(testDir, 'functions.ts'),
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(1);
        expect(parsed.locations[0].kind).toBe('function');
        expect(parsed.locations[0].name).toBe('myFunction');
    });

    it('should find class declarations', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'MyClass',
            path: join(testDir, 'classes.ts'),
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(1);
        expect(parsed.locations[0].kind).toBe('class');
    });

    it('should find variables', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'myConst',
            path: join(testDir, 'variables.ts'),
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(1);
        expect(parsed.locations[0].kind).toBe('const');
    });

    it('should find interfaces', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'MyInterface',
            path: join(testDir, 'types.ts'),
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(1);
        expect(parsed.locations[0].kind).toBe('interface');
    });

    it('should find type aliases', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'MyType',
            path: join(testDir, 'types.ts'),
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(1);
        expect(parsed.locations[0].kind).toBe('type');
    });

    it('should search recursively in directories', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'myFunction',
            path: testDir,
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBeGreaterThanOrEqual(1);
    });

    it('should filter by kind', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'myConst',
            path: join(testDir, 'variables.ts'),
            kind: 'const',
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(1);
        expect(parsed.locations[0].kind).toBe('const');
    });

    it('should return empty results for non-existent symbols', async () => {
        const result = await codingFindSymbolTool.execute({
            symbol: 'nonExistentSymbol',
            path: testDir,
        });
        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(0);
        expect(parsed.locations).toEqual([]);
    });

    it('should throw error if symbol is missing', async () => {
        await expect(codingFindSymbolTool.execute({ path: testDir }))
            .rejects.toThrow('symbol is required');
    });

    it('should throw error if path is missing', async () => {
        await expect(codingFindSymbolTool.execute({ symbol: 'test' }))
            .rejects.toThrow('path is required');
    });
});
