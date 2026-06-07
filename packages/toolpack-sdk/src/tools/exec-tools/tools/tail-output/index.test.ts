import { describe, it, expect, afterEach } from 'vitest';
import { execTailOutputTool } from './index.js';
import { execRunBackgroundTool } from '../run-background/index.js';
import { killProcess } from '../../process-registry.js';

describe('exec.tail_output tool', () => {
    const startedIds: string[] = [];

    afterEach(() => {
        for (const id of startedIds) {
            killProcess(id);
        }
        startedIds.length = 0;
    });

    it('should have correct metadata', () => {
        expect(execTailOutputTool.name).toBe('exec.tail_output');
        expect(execTailOutputTool.category).toBe('execution');
    });

    it('should return error for unknown process id', async () => {
        const result = JSON.parse(await execTailOutputTool.execute({ process_id: 'proc_unknown_xyz' }));
        expect(result.error).toBeDefined();
        expect(result.hint).toBeDefined();
    });

    it('should return alive=true while process is running', async () => {
        const bg = JSON.parse(await execRunBackgroundTool.execute({ command: 'sleep 5' }));
        startedIds.push(bg.id);

        const tail = JSON.parse(await execTailOutputTool.execute({ process_id: bg.id }));
        expect(tail.alive).toBe(true);
        expect(tail.exitCode).toBeNull();
    });

    it('should return last N lines of stdout', async () => {
        const isWindows = process.platform === 'win32';
        const command = isWindows
            ? 'for ($i=1; $i -le 10; $i++) { Write-Output "line $i" }'
            : 'for i in $(seq 1 10); do echo "line $i"; done';

        const bg = JSON.parse(await execRunBackgroundTool.execute({ command }));
        startedIds.push(bg.id);

        // Wait for the process to produce output
        await new Promise(r => setTimeout(r, 500));

        const tail = JSON.parse(await execTailOutputTool.execute({ process_id: bg.id, lines: 3 }));
        const lines = tail.lastLines.split('\n').filter((l: string) => l.trim());
        expect(lines.length).toBeLessThanOrEqual(3);
    }, 10000);

    it('should return alive=false and exitCode after process exits', async () => {
        const bg = JSON.parse(await execRunBackgroundTool.execute({ command: 'echo done' }));
        startedIds.push(bg.id);

        // Wait for the process to finish
        await new Promise(r => setTimeout(r, 300));

        const tail = JSON.parse(await execTailOutputTool.execute({ process_id: bg.id }));
        expect(tail.alive).toBe(false);
        expect(tail.exitCode).toBe(0);
        expect(tail.lastLines).toContain('done');
    }, 10000);

    it('should default to 20 lines when lines not specified', async () => {
        const bg = JSON.parse(await execRunBackgroundTool.execute({ command: 'echo hello' }));
        startedIds.push(bg.id);
        await new Promise(r => setTimeout(r, 300));

        const tail = JSON.parse(await execTailOutputTool.execute({ process_id: bg.id }));
        expect(tail).toHaveProperty('lastLines');
        expect(tail).toHaveProperty('totalStdoutLines');
    }, 10000);

    it('should throw if process_id is missing', async () => {
        await expect(execTailOutputTool.execute({})).rejects.toThrow('process_id is required');
    });
});
