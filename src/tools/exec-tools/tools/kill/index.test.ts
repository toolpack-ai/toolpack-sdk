import { describe, it, expect, afterEach } from 'vitest';
import { execRunBackgroundTool } from '../run-background/index.js';
import { execKillTool } from './index.js';
import { killProcess } from '../../process-registry.js';

describe('exec.kill tool', () => {
    const startedIds: string[] = [];

    afterEach(() => {
        for (const id of startedIds) {
            killProcess(id);
        }
        startedIds.length = 0;
    });

    it('should have correct metadata', () => {
        expect(execKillTool.name).toBe('exec.kill');
        expect(execKillTool.category).toBe('execution');
    });

    it('should kill a running background process', async () => {
        const bg = JSON.parse(await execRunBackgroundTool.execute({ command: 'sleep 60' }));
        startedIds.push(bg.id);
        const result = await execKillTool.execute({ process_id: bg.id });
        expect(result).toContain('killed successfully');
    });

    it('should report already terminated process', async () => {
        const bg = JSON.parse(await execRunBackgroundTool.execute({ command: 'echo done' }));
        startedIds.push(bg.id);
        await new Promise(r => setTimeout(r, 200));
        const result = await execKillTool.execute({ process_id: bg.id });
        expect(result).toContain('already terminated');
    });

    it('should throw if process_id is missing', async () => {
        await expect(execKillTool.execute({})).rejects.toThrow('process_id is required');
    });

    it('should throw if process not found', async () => {
        await expect(execKillTool.execute({ process_id: 'proc_999999' })).rejects.toThrow('Process not found');
    });
});
