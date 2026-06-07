import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { execRunBlockingTool } from './index.js';

describe('exec.run_blocking tool', () => {
    it('should have correct metadata', () => {
        expect(execRunBlockingTool.name).toBe('exec.run_blocking');
        expect(execRunBlockingTool.category).toBe('execution');
        expect(execRunBlockingTool.confirmation?.level).toBe('medium');
    });

    it('should execute a command and return structured result', async () => {
        const result = JSON.parse(await execRunBlockingTool.execute({ command: 'echo hello' }));
        expect(result.exitCode).toBe(0);
        expect(result.success).toBe(true);
        expect(result.stdout.trim()).toBe('hello');
        expect(result.stderr).toBe('');
    });

    it('should support pipes and shell features', async () => {
        const isWindows = process.platform === 'win32';
        const command = isWindows
            ? 'echo "hello world" | ForEach-Object { $_ -replace " ", "_" }'
            : 'echo "hello world" | tr " " "_"';
        const result = JSON.parse(await execRunBlockingTool.execute({ command }));
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('hello_world');
    });

    it('should wait for slow commands to complete naturally', async () => {
        const start = Date.now();
        const result = JSON.parse(await execRunBlockingTool.execute({
            command: `node -e "setTimeout(() => { process.stdout.write('done\\n'); }, 1000)"`,
        }));
        const elapsed = Date.now() - start;
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('done');
        expect(elapsed).toBeGreaterThanOrEqual(1000);
    }, 10000);

    it('should return non-zero exitCode and success=false for failing commands', async () => {
        const result = JSON.parse(await execRunBlockingTool.execute({
            command: 'ls /nonexistent-path-xyz 2>&1',
        }));
        expect(result.exitCode).not.toBe(0);
        expect(result.success).toBe(false);
    });

    it('should capture stderr separately', async () => {
        const isWindows = process.platform === 'win32';
        if (isWindows) return; // skip on Windows
        const result = JSON.parse(await execRunBlockingTool.execute({
            command: 'echo out && echo err >&2',
        }));
        expect(result.stdout.trim()).toBe('out');
        expect(result.stderr.trim()).toBe('err');
    });

    it('should throw if command is missing', async () => {
        await expect(execRunBlockingTool.execute({})).rejects.toThrow('command is required');
    });

    it('should accept a cwd argument', async () => {
        const cwd = tmpdir();
        const result = JSON.parse(await execRunBlockingTool.execute({
            command: `node -e "process.stdout.write(process.cwd())"`,
            cwd,
        }));
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe(cwd);
    });
});
