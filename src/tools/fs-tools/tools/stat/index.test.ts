import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fsStatTool } from './index.js';

describe('fs.stat tool', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-stat-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should have correct metadata', () => {
        expect(fsStatTool.name).toBe('fs.stat');
        expect(fsStatTool.category).toBe('filesystem');
    });

    it('should return file info', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'hello', 'utf-8');
        const result = JSON.parse(await fsStatTool.execute({ path: filePath }));
        expect(result.type).toBe('file');
        expect(result.size).toBe(5);
        expect(result.modified).toBeDefined();
    });

    it('should return directory info', async () => {
        const result = JSON.parse(await fsStatTool.execute({ path: tmpDir }));
        expect(result.type).toBe('directory');
    });

    it('should throw if path not found', async () => {
        await expect(fsStatTool.execute({ path: path.join(tmpDir, 'nope') })).rejects.toThrow('Path not found');
    });

    it('should throw if path is missing', async () => {
        await expect(fsStatTool.execute({})).rejects.toThrow('path is required');
    });
});
