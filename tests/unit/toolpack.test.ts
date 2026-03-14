import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Toolpack } from '../../src/toolpack';
import { ModeRegistry } from '../../src/modes/mode-registry';

describe('Toolpack - Mode Overrides', () => {
    let tmpDir: string;
    let originalCwd: () => string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolpack-mode-override-test-'));
        originalCwd = process.cwd;
        process.cwd = () => tmpDir;
    });

    afterEach(() => {
        process.cwd = originalCwd;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should apply mode overrides from programmatic config', async () => {
        const toolpack = await Toolpack.init({
            provider: 'openai',
            providers: {
                openai: { apiKey: 'test-key' }
            },
            modeOverrides: {
                'agent': { systemPrompt: 'Programmatic override for Agent mode' }
            }
        });

        // @ts-ignore - reaching into private state for test verification
        const registry: ModeRegistry = toolpack['modeRegistry'];
        const agentMode = registry.get('agent');

        expect(agentMode).toBeDefined();
        expect(agentMode?.systemPrompt).toBe('Programmatic override for Agent mode');
    });

    it('should apply mode overrides from toolpack.config.json', async () => {
        const configJson = {
            modeOverrides: {
                'chat': { systemPrompt: 'JSON override for Chat mode' }
            }
        };
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify(configJson)
        );

        const toolpack = await Toolpack.init({
            provider: 'openai',
            providers: {
                openai: { apiKey: 'test-key' }
            }
        });

        // @ts-ignore
        const registry: ModeRegistry = toolpack['modeRegistry'];
        const chatMode = registry.get('chat');

        expect(chatMode).toBeDefined();
        expect(chatMode?.systemPrompt).toBe('JSON override for Chat mode');
    });

    it('should merge programmatic and JSON mode overrides preferring programmatic', async () => {
        const configJson = {
            modeOverrides: {
                'chat': { systemPrompt: 'JSON Chat override' },
                'agent': { systemPrompt: 'JSON Agent override' }
            }
        };
        fs.writeFileSync(
            path.join(tmpDir, 'toolpack.config.json'),
            JSON.stringify(configJson)
        );

        const toolpack = await Toolpack.init({
            provider: 'openai',
            providers: {
                openai: { apiKey: 'test-key' }
            },
            modeOverrides: {
                'agent': { systemPrompt: 'Programmatic Agent override' }
            }
        });

        // @ts-ignore
        const registry: ModeRegistry = toolpack['modeRegistry'];

        expect(registry.get('chat')?.systemPrompt).toBe('JSON Chat override');
        expect(registry.get('agent')?.systemPrompt).toBe('Programmatic Agent override');
    });

    it('should apply mode overrides to custom modes added during init', async () => {
        const toolpack = await Toolpack.init({
            provider: 'openai',
            providers: {
                openai: { apiKey: 'test-key' }
            },
            customModes: [{
                name: 'my-custom',
                displayName: 'My Custom Mode',
                systemPrompt: 'Original prompt'
            }],
            modeOverrides: {
                'my-custom': { systemPrompt: 'Overridden custom prompt' }
            }
        });

        // @ts-ignore
        const registry: ModeRegistry = toolpack['modeRegistry'];
        const myMode = registry.get('my-custom');

        expect(myMode).toBeDefined();
        expect(myMode?.systemPrompt).toBe('Overridden custom prompt');
    });
});
