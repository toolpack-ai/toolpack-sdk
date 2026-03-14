import { describe, it, expect } from 'vitest';
import { systemEnvTool } from './index.js';

describe('system.env tool', () => {
    it('should have correct metadata', () => {
        expect(systemEnvTool.name).toBe('system.env');
        expect(systemEnvTool.category).toBe('system');
    });

    it('should return a specific env var', async () => {
        process.env.TEST_SYSTEM_ENV_TOOL = 'test_value_123';
        const result = JSON.parse(await systemEnvTool.execute({ key: 'TEST_SYSTEM_ENV_TOOL' }));
        expect(result.TEST_SYSTEM_ENV_TOOL).toBe('test_value_123');
        delete process.env.TEST_SYSTEM_ENV_TOOL;
    });

    it('should report unset variable', async () => {
        const result = await systemEnvTool.execute({ key: 'NONEXISTENT_VAR_XYZ_123' });
        expect(result).toContain('not set');
    });

    it('should return all env vars when no key given', async () => {
        const result = await systemEnvTool.execute({});
        const parsed = JSON.parse(result);
        expect(Object.keys(parsed).length).toBeGreaterThan(0);
        expect(parsed.PATH || parsed.Path).toBeDefined();
    });
});
