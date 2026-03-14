import { describe, it, expect, afterEach } from 'vitest';
import { execRunBackgroundTool } from '../run-background/index.js';
import { execListProcessesTool } from './index.js';
import { killProcess } from '../../process-registry.js';

describe('exec.list_processes tool', () => {
    const startedIds: string[] = [];

    afterEach(() => {
        for (const id of startedIds) {
            killProcess(id);
        }
        startedIds.length = 0;
    });

    it('should have correct metadata', () => {
        expect(execListProcessesTool.name).toBe('exec.list_processes');
        expect(execListProcessesTool.category).toBe('execution');
    });

    it('should list background processes', async () => {
        const bg = JSON.parse(await execRunBackgroundTool.execute({ command: 'sleep 60' }));
        startedIds.push(bg.id);
        const result = await execListProcessesTool.execute({});
        const list = JSON.parse(result);
        const found = list.find((p: any) => p.id === bg.id);
        expect(found).toBeDefined();
        expect(found.alive).toBe(true);
        expect(found.command).toBe('sleep 60');
    });
});
