import { describe, it, expect } from 'vitest';
import { systemInfoTool } from './index.js';

describe('system.info tool', () => {
    it('should have correct metadata', () => {
        expect(systemInfoTool.name).toBe('system.info');
        expect(systemInfoTool.category).toBe('system');
    });

    it('should return system information', async () => {
        const result = JSON.parse(await systemInfoTool.execute({}));
        expect(result.platform).toBeDefined();
        expect(result.arch).toBeDefined();
        expect(result.cpus).toBeDefined();
        expect(result.cpus.count).toBeGreaterThan(0);
        expect(result.memory.total).toBeGreaterThan(0);
        expect(result.nodeVersion).toMatch(/^v/);
    });
});
