import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { diffCreateTool } from './tools/create/index.js';
import { diffApplyTool } from './tools/apply/index.js';
import { diffPreviewTool } from './tools/preview/index.js';

describe('diff-tools integration', () => {
    let testDir: string;
    let testFilePath: string;

    beforeAll(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-tools-test-'));
        testFilePath = path.join(testDir, 'test.txt');
        fs.writeFileSync(testFilePath, 'Line 1\nLine 2\nLine 3\n');
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('should create a diff', async () => {
        const result = await diffCreateTool.execute({
            oldContent: 'Line 1\nLine 2\nLine 3\n',
            newContent: 'Line 1\nLine 2 changed\nLine 3\n',
            fileName: 'test.txt'
        });
        expect(result as string).toContain('-Line 2');
        expect(result as string).toContain('+Line 2 changed');
    });

    test('should preview a diff', async () => {
        const patch = await diffCreateTool.execute({
            oldContent: 'Line 1\nLine 2\nLine 3\n',
            newContent: 'Line 1\nLine 2 changed\nLine 3\n',
            fileName: 'test.txt'
        }) as string;

        const previewResult = await diffPreviewTool.execute({
            path: testFilePath,
            patch
        });

        expect(previewResult as string).toContain('Line 2 changed');
        expect(fs.readFileSync(testFilePath, 'utf8')).toBe('Line 1\nLine 2\nLine 3\n');
    });

    test('should apply a diff', async () => {
        const patch = await diffCreateTool.execute({
            oldContent: 'Line 1\nLine 2\nLine 3\n',
            newContent: 'Line 1\nLine 2 changed\nLine 3\n',
            fileName: 'test.txt'
        }) as string;

        const applyResult = await diffApplyTool.execute({
            path: testFilePath,
            patch
        });

        expect(applyResult as string).toContain('Successfully applied patch');
        expect(fs.readFileSync(testFilePath, 'utf8')).toBe('Line 1\nLine 2 changed\nLine 3\n');
    });
});
