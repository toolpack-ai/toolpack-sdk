import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadToolsConfig, saveToolsConfig } from '../../src/tools/config-loader.js';

describe('loadToolsConfig', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-loader-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should return defaults when config file does not exist', () => {
        const config = loadToolsConfig(tmpDir);
        expect(config.enabled).toBe(true);
        expect(config.autoExecute).toBe(true);
        expect(config.maxToolRounds).toBe(5);
        expect(config.enabledTools).toEqual([]);
        expect(config.enabledToolCategories).toEqual([]);
    });

    it('should parse tools section from toolpack.config.json', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify({
                tools: {
                    enabled: false,
                    autoExecute: false,
                    maxToolRounds: 10,
                    enabledTools: ['fs.read_file'],
                    enabledToolCategories: ['filesystem'],
                },
            }),
        );

        const config = loadToolsConfig(tmpDir);
        expect(config.enabled).toBe(false);
        expect(config.autoExecute).toBe(false);
        expect(config.maxToolRounds).toBe(10);
        expect(config.enabledTools).toEqual(['fs.read_file']);
        expect(config.enabledToolCategories).toEqual(['filesystem']);
    });

    it('should merge partial config with defaults', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify({
                tools: {
                    maxToolRounds: 20,
                },
            }),
        );

        const config = loadToolsConfig(tmpDir);
        expect(config.enabled).toBe(true); // default
        expect(config.autoExecute).toBe(true); // default
        expect(config.maxToolRounds).toBe(20); // overridden
    });

    it('should preserve additionalConfigurations', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify({
                tools: {
                    enabled: true,
                    autoExecute: true,
                    maxToolRounds: 5,
                    enabledTools: [],
                    enabledToolCategories: [],
                    additionalConfigurations: {
                        webSearch: {
                            tavilyApiKey: 'test-key',
                            braveApiKey: '',
                        },
                    },
                },
            }),
        );

        const config = loadToolsConfig(tmpDir);
        expect(config.additionalConfigurations?.webSearch?.tavilyApiKey).toBe('test-key');
        expect(config.additionalConfigurations?.webSearch?.braveApiKey).toBe('');
    });

    it('should handle malformed JSON gracefully', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            '{{{invalid json',
        );

        const config = loadToolsConfig(tmpDir);
        expect(config.enabled).toBe(true);
        expect(config.autoExecute).toBe(true);
    });
});

describe('saveToolsConfig', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-save-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should write config to tools section without clobbering other sections', () => {
        // Write an existing config with other sections
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify({
                fastAIModels: { openai: 'gpt-4.1-mini' },
                tools: { enabled: true, autoExecute: true, maxToolRounds: 5, enabledTools: [], enabledToolCategories: [] },
            }),
        );

        const newToolsConfig = loadToolsConfig(tmpDir);
        newToolsConfig.maxToolRounds = 15;
        saveToolsConfig(newToolsConfig, tmpDir);

        // Re-read the full file
        const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'toolpack.config.json'), 'utf-8'));
        expect(raw.fastAIModels).toEqual({ openai: 'gpt-4.1-mini' }); // preserved
        expect(raw.tools.maxToolRounds).toBe(15); // updated
    });

    it('should create config file if it does not exist', () => {
        const config = loadToolsConfig(tmpDir);
        saveToolsConfig(config, tmpDir);

        expect(fs.existsSync(path.join(tmpDir, 'toolpack.config.json'))).toBe(true);
        const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'toolpack.config.json'), 'utf-8'));
        expect(raw.tools).toBeDefined();
        expect(raw.tools.enabled).toBe(true);
    });
});
