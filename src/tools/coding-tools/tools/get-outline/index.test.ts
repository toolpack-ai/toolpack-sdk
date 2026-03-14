import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { codingGetOutlineTool } from './index.js';

describe('coding.get_outline', () => {
    const testDir = join(process.cwd(), 'test-get-outline-temp');
    const testFile = join(testDir, 'test.py');

    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });

        writeFileSync(testFile, `
class MyClass(object):
    def __init__(self):
        pass
        
    def my_method(self):
        return 42

def global_function():
    return "hello"
        `);
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('should list all symbols logically', async () => {
        const result = await codingGetOutlineTool.execute({ file: testFile });
        const parsed = JSON.parse(result);

        expect(parsed.outline).toBeDefined();
        expect(parsed.outline).toBeInstanceOf(Array);

        const names = parsed.outline.map((n: any) => n.name);
        expect(names).toContain('MyClass');
        expect(names).toContain('my_method');
        expect(names).toContain('global_function');
    });

    it('should throw error if file is missing', async () => {
        await expect(codingGetOutlineTool.execute({}))
            .rejects.toThrow('file is required');
    });

    it('should throw error for invalid file', async () => {
        await expect(codingGetOutlineTool.execute({ file: '/nonexistent/file.py' }))
            .rejects.toThrow();
    });
});
