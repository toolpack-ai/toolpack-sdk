import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsExistsTool } from './index.js';

describe('fs.exists tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-exists-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsExistsTool.name).toBe('fs.exists');
        expect(fsExistsTool.category).toBe('filesystem');
    });

    it('should return true for existing file', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'data', 'utf-8');
        const result = JSON.parse(await fsExistsTool.execute({ path: filePath }));
        expect(result.exists).toBe(true);
    });

    it('should return true for existing directory', async () => {
        const result = JSON.parse(await fsExistsTool.execute({ path: tmpDir }));
        expect(result.exists).toBe(true);
    });

    it('should return false for non-existent path', async () => {
        const result = JSON.parse(await fsExistsTool.execute({ path: path.join(tmpDir, 'nope') }));
        expect(result.exists).toBe(false);
    });

    it('should throw if path is missing', async () => {
        await expect(fsExistsTool.execute({})).rejects.toThrow('path is required');
    });
});
