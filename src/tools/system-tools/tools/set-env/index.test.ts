import { describe, it, expect, afterEach } from 'vitest';
import { systemSetEnvTool } from './index.js';

describe('system.set_env tool', () => {
    afterEach(() => {
        delete process.env.TEST_SET_ENV_TOOL;
    });

    it('should have correct metadata', () => {
        expect(systemSetEnvTool.name).toBe('system.set_env');
        expect(systemSetEnvTool.category).toBe('system');
    });

    it('should set a new env var', async () => {
        const result = await systemSetEnvTool.execute({ key: 'TEST_SET_ENV_TOOL', value: 'abc' });
        expect(result).toContain('set to');
        expect(process.env.TEST_SET_ENV_TOOL).toBe('abc');
    });

    it('should update an existing env var', async () => {
        process.env.TEST_SET_ENV_TOOL = 'old';
        const result = await systemSetEnvTool.execute({ key: 'TEST_SET_ENV_TOOL', value: 'new' });
        expect(result).toContain('updated');
        expect(process.env.TEST_SET_ENV_TOOL).toBe('new');
    });

    it('should throw if key is missing', async () => {
        await expect(systemSetEnvTool.execute({ value: 'x' })).rejects.toThrow('key is required');
    });

    it('should throw if value is missing', async () => {
        await expect(systemSetEnvTool.execute({ key: 'X' })).rejects.toThrow('value is required');
    });
});
