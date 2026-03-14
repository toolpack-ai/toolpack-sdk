import { describe, it, expect } from 'vitest';
import { execRunShellTool } from './index.js';

describe('exec.run_shell tool', () => {
    it('should have correct metadata', () => {
        expect(execRunShellTool.name).toBe('exec.run_shell');
        expect(execRunShellTool.category).toBe('execution');
    });

    it('should execute a shell command', async () => {
        const result = await execRunShellTool.execute({ command: 'echo hello' });
        expect(result.trim()).toBe('hello');
    });

    it('should support pipes', async () => {
        const result = await execRunShellTool.execute({ command: 'echo "hello world" | tr " " "_"' });
        expect(result.trim()).toBe('hello_world');
    });

    it('should support environment variable expansion', async () => {
        const result = await execRunShellTool.execute({ command: 'echo $HOME' });
        expect(result.trim()).toBeTruthy();
        expect(result.trim()).not.toBe('$HOME');
    });

    it('should handle failing commands gracefully', async () => {
        const result = await execRunShellTool.execute({ command: 'exit 1' });
        expect(result).toContain('Command failed');
    });

    it('should throw if command is missing', async () => {
        await expect(execRunShellTool.execute({})).rejects.toThrow('command is required');
    });
});
