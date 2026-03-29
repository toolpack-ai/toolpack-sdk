import { describe, it, expect } from 'vitest';
import { execRunTool } from './index.js';
import * as os from 'os';

describe('exec.run tool', () => {
    it('should have correct metadata', () => {
        expect(execRunTool.name).toBe('exec.run');
        expect(execRunTool.category).toBe('execution');
    });

    it('should execute a simple command', async () => {
        const result = await execRunTool.execute({ command: 'echo hello' });
        expect(result.trim()).toBe('hello');
    });

    it('should execute with cwd', async () => {
        const tmpDir = os.tmpdir();
        const isWindows = process.platform === 'win32';
        const command = isWindows ? 'cd' : 'pwd';
        const result = await execRunTool.execute({ command, cwd: tmpDir });
        // Normalize paths for comparison (Windows uses backslashes)
        const normalizedResult = result.trim().replace(/\\/g, '/');
        const normalizedTmpDir = tmpDir.replace(/\\/g, '/');
        expect(normalizedResult).toContain(normalizedTmpDir);
    });

    it('should handle failing commands gracefully', async () => {
        const result = await execRunTool.execute({ command: 'ls /nonexistent_path_xyz' });
        expect(result).toContain('Command failed');
    });

    it('should throw if command is missing', async () => {
        await expect(execRunTool.execute({})).rejects.toThrow('command is required');
    });

    it('should handle commands with no output', async () => {
        const result = await execRunTool.execute({ command: 'true' });
        expect(result).toBe('(command completed with no output)');
    });
});
