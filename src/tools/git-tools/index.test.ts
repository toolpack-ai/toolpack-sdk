import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { gitStatusTool } from './tools/status/index.js';
import { gitAddTool } from './tools/add/index.js';
import { gitCommitTool } from './tools/commit/index.js';

describe('git-tools integration', () => {
    let testDir: string;
    let git: SimpleGit;
    let originalCwd: string;

    beforeAll(async () => {
        originalCwd = process.cwd();
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tools-test-'));
        process.chdir(testDir);

        git = simpleGit(testDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterAll(() => {
        process.chdir(originalCwd);
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('should return clean status initially', async () => {
        const result = await gitStatusTool.execute({});
        expect(result as string).toContain('Working tree clean');
    });

    test('should add and commit a file', async () => {
        fs.writeFileSync(path.join(testDir, 'test.txt'), 'hello world');

        let status = await gitStatusTool.execute({});
        expect(status as string).toContain('Untracked: test.txt');

        await gitAddTool.execute({ path: 'test.txt' });

        status = await gitStatusTool.execute({});
        expect(status as string).toContain('Staged: test.txt');

        const commitResult = await gitCommitTool.execute({ message: 'Initial commit' });
        expect(commitResult as string).toContain('Successfully committed changes');

        status = await gitStatusTool.execute({});
        expect(status as string).toContain('Working tree clean');
    });
});
