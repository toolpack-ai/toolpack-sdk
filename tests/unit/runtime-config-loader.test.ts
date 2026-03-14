import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    loadRuntimeConfig,
    getRuntimeConfigStatus,
    initializeGlobalConfigIfFirstRun
} from '../../src/utils/runtime-config-loader.js';

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: vi.fn(),
    };
});

// We need to mock the entire config module
vi.mock('../../src/providers/config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/providers/config.js')>();
    return {
        ...actual,
        discoverConfigPath: vi.fn(),
    };
});

import * as configProvider from '../../src/providers/config.js';

describe('runtime-config-loader', () => {
    let mockHomedir: string;
    let tmpWorkspace: string;

    beforeEach(() => {
        mockHomedir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-home-'));
        vi.mocked(os.homedir).mockReturnValue(mockHomedir);
        tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-workspace-'));
        
        // Mock discoverConfigPath to point to our temp workspace for build config testing
        vi.mocked(configProvider.discoverConfigPath).mockImplementation(() => {
            const buildConfigPath = path.join(tmpWorkspace, 'toolpack.config.json');
            if (fs.existsSync(buildConfigPath)) return buildConfigPath;
            return null;
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        fs.rmSync(mockHomedir, { recursive: true, force: true });
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    });

    describe('getRuntimeConfigStatus', () => {
        it('should detect first run when global config does not exist', () => {
            const status = getRuntimeConfigStatus(tmpWorkspace);
            expect(status.isFirstRun).toBe(true);
            expect(status.configSource).toBe('default');
            expect(status.activeConfigPath).toBeNull();
        });

        it('should detect global config source', () => {
            const globalConfigDir = path.join(mockHomedir, '.toolpack', 'config');
            fs.mkdirSync(globalConfigDir, { recursive: true });
            const globalConfigPath = path.join(globalConfigDir, 'toolpack.config.json');
            fs.writeFileSync(globalConfigPath, '{}');

            const status = getRuntimeConfigStatus(tmpWorkspace);
            expect(status.isFirstRun).toBe(false);
            expect(status.configSource).toBe('global');
            expect(status.activeConfigPath).toBe(globalConfigPath);
        });

        it('should detect local config source (priority over global)', () => {
            const globalConfigDir = path.join(mockHomedir, '.toolpack', 'config');
            fs.mkdirSync(globalConfigDir, { recursive: true });
            fs.writeFileSync(path.join(globalConfigDir, 'toolpack.config.json'), '{}');

            const localConfigDir = path.join(tmpWorkspace, '.toolpack', 'config');
            fs.mkdirSync(localConfigDir, { recursive: true });
            const localConfigPath = path.join(localConfigDir, 'toolpack.config.json');
            fs.writeFileSync(localConfigPath, '{}');

            const status = getRuntimeConfigStatus(tmpWorkspace);
            expect(status.isFirstRun).toBe(false);
            expect(status.configSource).toBe('local');
            expect(status.activeConfigPath).toBe(localConfigPath);
        });
    });

    describe('initializeGlobalConfigIfFirstRun', () => {
        it('should create global config with empty object if no build config exists', () => {
            initializeGlobalConfigIfFirstRun(tmpWorkspace);

            const globalConfigPath = path.join(mockHomedir, '.toolpack', 'config', 'toolpack.config.json');
            expect(fs.existsSync(globalConfigPath)).toBe(true);
            
            const content = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
            expect(content).toEqual({});
        });

        it('should seed global config from build config if it exists', () => {
            const buildConfigPath = path.join(tmpWorkspace, 'toolpack.config.json');
            const buildConfig = {
                systemPrompt: 'Custom prompt',
                logging: { enabled: true }
            };
            fs.writeFileSync(buildConfigPath, JSON.stringify(buildConfig));

            initializeGlobalConfigIfFirstRun(tmpWorkspace);

            const globalConfigPath = path.join(mockHomedir, '.toolpack', 'config', 'toolpack.config.json');
            expect(fs.existsSync(globalConfigPath)).toBe(true);
            
            const content = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
            expect(content).toEqual(buildConfig);
        });

        it('should not overwrite existing global config', () => {
            const globalConfigDir = path.join(mockHomedir, '.toolpack', 'config');
            fs.mkdirSync(globalConfigDir, { recursive: true });
            const globalConfigPath = path.join(globalConfigDir, 'toolpack.config.json');
            fs.writeFileSync(globalConfigPath, JSON.stringify({ systemPrompt: 'Existing' }));

            const buildConfigPath = path.join(tmpWorkspace, 'toolpack.config.json');
            fs.writeFileSync(buildConfigPath, JSON.stringify({ systemPrompt: 'New build config' }));

            initializeGlobalConfigIfFirstRun(tmpWorkspace);

            const content = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
            expect(content.systemPrompt).toBe('Existing');
        });
    });

    describe('loadRuntimeConfig', () => {
        it('should return empty object if no configs exist', () => {
            const config = loadRuntimeConfig(tmpWorkspace);
            expect(config).toEqual({});
        });

        it('should load global config if local does not exist', () => {
            const globalConfigDir = path.join(mockHomedir, '.toolpack', 'config');
            fs.mkdirSync(globalConfigDir, { recursive: true });
            fs.writeFileSync(path.join(globalConfigDir, 'toolpack.config.json'), JSON.stringify({
                systemPrompt: 'Global prompt',
                logging: { enabled: true }
            }));

            const config = loadRuntimeConfig(tmpWorkspace);
            expect(config.systemPrompt).toBe('Global prompt');
            expect(config.logging?.enabled).toBe(true);
        });

        it('should load base config if no other configs exist', () => {
            fs.writeFileSync(path.join(tmpWorkspace, 'toolpack.config.json'), JSON.stringify({
                systemPrompt: 'Base prompt',
                logging: { enabled: false }
            }));

            const config = loadRuntimeConfig(tmpWorkspace);
            expect(config.systemPrompt).toBe('Base prompt');
            expect(config.logging?.enabled).toBe(false);
        });

        it('should merge base, global, and local configs with correct precedence', () => {
            // Base config
            fs.writeFileSync(path.join(tmpWorkspace, 'toolpack.config.json'), JSON.stringify({
                systemPrompt: 'Base prompt',
                logging: { enabled: true, verbose: false },
                openai: { baseUrl: 'http://base' }
            }));

            // Global config
            const globalConfigDir = path.join(mockHomedir, '.toolpack', 'config');
            fs.mkdirSync(globalConfigDir, { recursive: true });
            fs.writeFileSync(path.join(globalConfigDir, 'toolpack.config.json'), JSON.stringify({
                systemPrompt: 'Global prompt', // Overrides base
                logging: { verbose: true }, // Deep merges with base logging
                ollama: { baseUrl: 'http://localhost:11434' },
                openai: { baseUrl: 'http://global' }
            }));

            // Local config
            const localConfigDir = path.join(tmpWorkspace, '.toolpack', 'config');
            fs.mkdirSync(localConfigDir, { recursive: true });
            fs.writeFileSync(path.join(localConfigDir, 'toolpack.config.json'), JSON.stringify({
                systemPrompt: 'Local prompt', // Overrides global and base
                openai: { baseUrl: 'http://local' } // Deep merges with base tools
            }));

            const config = loadRuntimeConfig(tmpWorkspace);
            expect(config.systemPrompt).toBe('Local prompt'); // Local wins
            expect(config.logging?.enabled).toBe(true); // From base
            expect(config.logging?.verbose).toBe(true); // From global
            expect(config.openai?.baseUrl).toBe('http://local'); // From local (overriding base & global)
            expect(config.ollama?.baseUrl).toBe('http://localhost:11434'); // From global
        });
        
        it('should overwrite arrays during merge, not append', () => {
            const globalConfigDir = path.join(mockHomedir, '.toolpack', 'config');
            fs.mkdirSync(globalConfigDir, { recursive: true });
            fs.writeFileSync(path.join(globalConfigDir, 'toolpack.config.json'), JSON.stringify({
                ollama: { models: [{ model: 'llama3' }, { model: 'mistral' }] }
            }));

            const localConfigDir = path.join(tmpWorkspace, '.toolpack', 'config');
            fs.mkdirSync(localConfigDir, { recursive: true });
            fs.writeFileSync(path.join(localConfigDir, 'toolpack.config.json'), JSON.stringify({
                ollama: { models: [{ model: 'phi3' }] }
            }));

            const config = loadRuntimeConfig(tmpWorkspace);
            expect(config.ollama?.models?.length).toBe(1);
            expect(config.ollama?.models?.[0].model).toBe('phi3');
        });
    });
});
