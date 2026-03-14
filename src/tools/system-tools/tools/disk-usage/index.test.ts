import { describe, it, expect } from 'vitest';
import { systemDiskUsageTool } from './index.js';

describe('system.disk_usage tool', () => {
    it('should have correct metadata', () => {
        expect(systemDiskUsageTool.name).toBe('system.disk_usage');
        expect(systemDiskUsageTool.category).toBe('system');
    });

    it('should return disk usage for root', async () => {
        const result = JSON.parse(await systemDiskUsageTool.execute({}));
        expect(result.filesystem).toBeDefined();
        expect(result.size).toBeDefined();
        expect(result.used).toBeDefined();
        expect(result.available).toBeDefined();
        expect(result.usePercent).toBeDefined();
    });

    it('should return disk usage for /tmp', async () => {
        const result = JSON.parse(await systemDiskUsageTool.execute({ path: '/tmp' }));
        expect(result.path).toBe('/tmp');
        expect(result.filesystem).toBeDefined();
    });
});
