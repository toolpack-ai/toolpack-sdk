import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { systemDiskUsageTool } from './index.js';

describe('system.disk_usage tool', () => {
    it('should have correct metadata', () => {
        expect(systemDiskUsageTool.name).toBe('system.disk_usage');
        expect(systemDiskUsageTool.category).toBe('system');
    });

    it('should return disk usage for root or temp directory', async () => {
        const result = JSON.parse(await systemDiskUsageTool.execute({}));
        expect(result.filesystem).toBeDefined();
        expect(result.size).toBeDefined();
        expect(result.used).toBeDefined();
        expect(result.available).toBeDefined();
        expect(result.usePercent).toBeDefined();
    });

    it('should return disk usage for a specific path', async () => {
        const isWindows = process.platform === 'win32';
        const testPath = isWindows ? 'C:\\Windows' : '/tmp';
        const result = JSON.parse(await systemDiskUsageTool.execute({ path: testPath }));
        expect(result.path).toBe(testPath);
        expect(result.filesystem).toBeDefined();
    });
});
