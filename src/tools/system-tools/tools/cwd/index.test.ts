import { describe, it, expect } from 'vitest';
import { systemCwdTool } from './index.js';

describe('system.cwd tool', () => {
    it('should have correct metadata', () => {
        expect(systemCwdTool.name).toBe('system.cwd');
        expect(systemCwdTool.category).toBe('system');
    });

    it('should return current working directory', async () => {
        const result = JSON.parse(await systemCwdTool.execute({}));
        expect(result.cwd).toBe(process.cwd());
    });
});
