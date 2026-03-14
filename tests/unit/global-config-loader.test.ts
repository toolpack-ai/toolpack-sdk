import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadGlobalConfig } from '../../src/utils/global-config-loader.js';

describe('loadGlobalConfig', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-config-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should return default fastAIModels when config file does not exist', () => {
        const config = loadGlobalConfig(tmpDir);
        expect(config.fastAIModels).toBeDefined();
        expect(config.fastAIModels).toHaveProperty('openai');
        expect(config.fastAIModels).toHaveProperty('anthropic');
        expect(config.fastAIModels).toHaveProperty('gemini');
    });

    it('should parse fastAIModels from file', () => {
        const customModels = {
            openai: 'gpt-4-turbo',
            anthropic: 'claude-3-opus',
            gemini: 'gemini-1.5-pro',
        };
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify({ fastAIModels: customModels }),
        );

        const config = loadGlobalConfig(tmpDir);
        expect(config.fastAIModels).toEqual(customModels);
    });

    it('should fall back to defaults when fastAIModels is missing from file', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify({ someOtherKey: true }),
        );

        const config = loadGlobalConfig(tmpDir);
        expect(config.fastAIModels).toHaveProperty('openai');
        expect(config.fastAIModels).toHaveProperty('anthropic');
        expect(config.fastAIModels).toHaveProperty('gemini');
    });

    it('should handle malformed JSON gracefully', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            'not valid json {{{',
        );

        const config = loadGlobalConfig(tmpDir);
        expect(config.fastAIModels).toBeDefined();
        expect(config.fastAIModels).toHaveProperty('openai');
    });
});
