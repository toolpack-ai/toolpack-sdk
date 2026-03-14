import { describe, it, expect } from 'vitest';
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
        const result = await execRunTool.execute({ command: 'pwd', cwd: '/tmp' });
        expect(result.trim()).toMatch(/\/tmp|\/private\/tmp/);
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
