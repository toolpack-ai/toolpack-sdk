import { describe, it, expect, afterEach } from 'vitest';
import { execRunBackgroundTool } from './index.js';
import { getProcess, killProcess } from '../../process-registry.js';

describe('exec.run_background tool', () => {
    const startedIds: string[] = [];

    afterEach(() => {
        for (const id of startedIds) {
            killProcess(id);
        }
        startedIds.length = 0;
    });

    it('should have correct metadata', () => {
        expect(execRunBackgroundTool.name).toBe('exec.run_background');
        expect(execRunBackgroundTool.category).toBe('execution');
    });

    it('should start a background process and return an id', async () => {
        const result = JSON.parse(await execRunBackgroundTool.execute({ command: 'sleep 10' }));
        startedIds.push(result.id);
        expect(result.id).toMatch(/^proc_/);
        expect(result.pid).toBeDefined();
    });

    it('should register the process in the registry', async () => {
        const result = JSON.parse(await execRunBackgroundTool.execute({ command: 'sleep 10' }));
        startedIds.push(result.id);
        const managed = getProcess(result.id);
        expect(managed).toBeDefined();
        expect(managed!.command).toBe('sleep 10');
    });

    it('should throw if command is missing', async () => {
        await expect(execRunBackgroundTool.execute({})).rejects.toThrow('command is required');
    });
});
