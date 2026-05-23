import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { gitStatusTool } from './tools/status/index.js';
import { gitAddTool } from './tools/add/index.js';
import { gitCommitTool } from './tools/commit/index.js';
import { gitDiffTool } from './tools/diff/index.js';
import { gitLogTool } from './tools/log/index.js';
import { gitBlameTool } from './tools/blame/index.js';

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

    test('should run read-only git tools inside cloneDir', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tools-clonedir-test-'));
        const repoGit = simpleGit(repoDir);
        await repoGit.init();
        await repoGit.addConfig('user.name', 'Test User');
        await repoGit.addConfig('user.email', 'test@example.com');
        fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\n');
        await repoGit.add('tracked.txt');
        await repoGit.commit('Initial commit');
        fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'hello\nworld\n');

        const diff = await gitDiffTool.execute({ cloneDir: repoDir, path: 'tracked.txt' });
        expect(diff as string).toContain('+world');

        await repoGit.add('tracked.txt');
        await repoGit.commit('Add world');

        const log = await gitLogTool.execute({ cloneDir: repoDir, path: 'tracked.txt', maxCount: 1 });
        expect(log as string).toContain('Add world');

        const blame = await gitBlameTool.execute({ cloneDir: repoDir, path: 'tracked.txt' });
        expect(blame as string).toContain('world');

        fs.rmSync(repoDir, { recursive: true, force: true });
    });
});
