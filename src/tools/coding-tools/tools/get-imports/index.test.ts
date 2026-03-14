import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingGetImportsTool } from './index.js';

describe('coding.get_imports', () => {
    const testDir = join(process.cwd(), 'test-get-imports-temp');
    const testFile = join(testDir, 'test.ts');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
        
        writeFileSync(testFile, `
import React from 'react';
import { useState, useEffect } from 'react';
import * as fs from 'fs';
import { readFile as read } from 'fs/promises';
import './styles.css';
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should list all imports in a file', async () => {
        const result = await codingGetImportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        expect(parsed.count).toBeGreaterThan(0);
        expect(parsed.imports).toBeInstanceOf(Array);
    });

    it('should identify default imports', async () => {
        const result = await codingGetImportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const defaultImport = parsed.imports.find((i: any) => i.source === 'react' && i.type === 'default');
        expect(defaultImport).toBeDefined();
        expect(defaultImport.imports).toContain('React');
    });

    it('should identify named imports', async () => {
        const result = await codingGetImportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const namedImport = parsed.imports.find((i: any) => 
            i.source === 'react' && i.type === 'named'
        );
        expect(namedImport).toBeDefined();
        expect(namedImport.imports).toContain('useState');
        expect(namedImport.imports).toContain('useEffect');
    });

    it('should identify namespace imports', async () => {
        const result = await codingGetImportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const namespaceImport = parsed.imports.find((i: any) => i.type === 'namespace');
        expect(namespaceImport).toBeDefined();
        expect(namespaceImport.imports[0]).toContain('* as fs');
    });

    it('should identify aliased imports', async () => {
        const result = await codingGetImportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const aliasedImport = parsed.imports.find((i: any) => 
            i.source === 'fs/promises'
        );
        expect(aliasedImport).toBeDefined();
        expect(aliasedImport.imports[0]).toContain('readFile as read');
    });

    it('should identify side-effect imports', async () => {
        const result = await codingGetImportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        const sideEffectImport = parsed.imports.find((i: any) => 
            i.source === './styles.css'
        );
        expect(sideEffectImport).toBeDefined();
        expect(sideEffectImport.type).toBe('side-effect');
    });

    it('should include line numbers', async () => {
        const result = await codingGetImportsTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        expect(parsed.imports[0]).toHaveProperty('line');
        expect(parsed.imports[0].line).toBeGreaterThan(0);
    });

    it('should handle files with no imports', async () => {
        const noImportsFile = join(testDir, 'no-imports.ts');
        writeFileSync(noImportsFile, 'const x = 1;');

        const result = await codingGetImportsTool.execute({ file: noImportsFile });
        const parsed = JSON.parse(result);

        expect(parsed.count).toBe(0);
        expect(parsed.imports).toEqual([]);
    });

    it('should throw error if file is missing', async () => {
        await expect(codingGetImportsTool.execute({}))
            .rejects.toThrow('file is required');
    });

    it('should throw error for invalid file', async () => {
        await expect(codingGetImportsTool.execute({ file: '/nonexistent/file.ts' }))
            .rejects.toThrow();
    });
});
