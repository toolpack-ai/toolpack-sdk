import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { execRunTool } from './index.js';

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
        const failCommand = process.platform === 'win32'
            ? `"${process.execPath}" -e "process.exit(1)"`
            : 'false';

        const result = await execRunTool.execute({ command: failCommand });
        expect(result).toContain('Command failed');
    });

    it('should throw if command is missing', async () => {
        await expect(execRunTool.execute({})).rejects.toThrow('command is required');
    });

    it('should handle commands with no output', async () => {
        const noOutputCommand = process.platform === 'win32'
            ? `"${process.execPath}" -e "process.exit(0)"`
            : 'true';

        const result = await execRunTool.execute({ command: noOutputCommand });
        expect(result).toBe('(command completed with no output)');
    });
});
