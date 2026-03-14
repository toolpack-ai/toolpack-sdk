import { describe, it, expect, afterEach } from 'vitest';
import { execRunBackgroundTool } from '../run-background/index.js';
import { execReadOutputTool } from './index.js';
import { killProcess } from '../../process-registry.js';

describe('exec.read_output tool', () => {
    const startedIds: string[] = [];

    afterEach(() => {
        for (const id of startedIds) {
            killProcess(id);
        }
        startedIds.length = 0;
    });

    it('should have correct metadata', () => {
        expect(execReadOutputTool.name).toBe('exec.read_output');
        expect(execReadOutputTool.category).toBe('execution');
    });

    it('should read output from a background process', async () => {
        const bg = JSON.parse(await execRunBackgroundTool.execute({ command: 'echo hello_from_bg' }));
        startedIds.push(bg.id);
        // Wait a bit for output to be captured
        await new Promise(r => setTimeout(r, 200));
        const result = JSON.parse(await execReadOutputTool.execute({ process_id: bg.id }));
        expect(result.stdout).toContain('hello_from_bg');
    });

    it('should throw if process_id is missing', async () => {
        await expect(execReadOutputTool.execute({})).rejects.toThrow('process_id is required');
    });

    it('should throw if process not found', async () => {
        await expect(execReadOutputTool.execute({ process_id: 'proc_999999' })).rejects.toThrow('Process not found');
    });
});
