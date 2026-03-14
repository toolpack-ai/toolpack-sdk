import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../../src/providers/ollama/provider';
import * as httpHelpers from '../../src/providers/ollama/http';

vi.mock('../../src/providers/provider-logger', () => ({
    log: vi.fn(),
    safePreview: vi.fn(),
    logMessagePreview: vi.fn(),
    isVerbose: vi.fn(() => false),
    LOG_VERBOSE: false,
}));

describe('OllamaProvider', () => {
    let mockOllamaRequest: any;

    beforeEach(() => {
        vi.resetModules();
        mockOllamaRequest = vi.spyOn(httpHelpers, 'ollamaRequest');
    });

    it('should return display name', () => {
        const provider = new OllamaProvider();
        expect(provider.getDisplayName()).toBe('Ollama');
    });

    it('should fetch models and detect capabilities via probe and /api/show', async () => {
        const provider = new OllamaProvider();

        // Mock /api/tags, /api/show, and /api/chat (probe)
        mockOllamaRequest.mockImplementation(async (baseUrl: string, path: string, method: string, body: any) => {
            if (path === '/api/tags') {
                return {
                    status: 200,
                    body: JSON.stringify({
                        models: [
                            { name: 'llama3.2:latest' },
                            { name: 'llava:latest' },
                            { name: 'nomic-embed-text:latest' },
                            { name: 'unknown-model' }
                        ]
                    })
                };
            }
            if (path === '/api/show') {
                // Return clip family for llava to test vision detection
                if (body?.model === 'llava:latest') {
                    return { status: 200, body: JSON.stringify({ details: { families: ['llama', 'clip'] } }) };
                }
                if (body?.model === 'nomic-embed-text:latest') {
                    return { status: 200, body: JSON.stringify({ details: { families: ['nomic-bert'] } }) };
                }
                return { status: 200, body: JSON.stringify({ details: { families: [] } }) };
            }
            if (path === '/api/chat') {
                // Probe: llama3.2 supports tools, others don't
                if (body?.model === 'llama3.2:latest') {
                    return { status: 200, body: JSON.stringify({ message: { role: 'assistant', content: 'hi' } }) };
                }
                return { status: 400, body: JSON.stringify({ error: 'does not support tools' }) };
            }
            throw new Error('unexpected request');
        });

        const models = await provider.getModels();
        expect(models).toHaveLength(4);

        // llama3.2 (tools via probe)
        expect(models[0].id).toBe('llama3.2:latest');
        expect(models[0].capabilities.toolCalling).toBe(true);
        expect(models[0].capabilities.vision).toBe(false);

        // llava (vision via /api/show family, no tools)
        expect(models[1].id).toBe('llava:latest');
        expect(models[1].capabilities.vision).toBe(true);
        expect(models[1].capabilities.toolCalling).toBe(false);

        // nomic-embed (embeddings via /api/show family)
        expect(models[2].id).toBe('nomic-embed-text:latest');
        expect(models[2].capabilities.embeddings).toBe(true);

        // unknown-model (defaults — probe fails, no families)
        expect(models[3].id).toBe('unknown-model');
        expect(models[3].capabilities.toolCalling).toBe(false);
        expect(models[3].capabilities.vision).toBe(false);
    });

    it('should strip tools from requests for non-capable models', async () => {
        const provider = new OllamaProvider();

        // Set up capability cache directly for testing
        (provider as any).capabilityCache.set('phi3:mini', { toolCalling: false, vision: false, embeddings: false });
        (provider as any).capabilityCache.set('llama3.2', { toolCalling: true, vision: false, embeddings: false });

        const requestWithTools: any = {
            model: 'phi3:mini',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [{ function: { name: 'test', parameters: {} } }],
            tool_choice: 'auto',
        };

        // Non-capable model: tools should be stripped, system notice appended
        const stripped = (provider as any).stripToolsIfNeeded(requestWithTools);
        expect(stripped.tools).toBeUndefined();
        expect(stripped.tool_choice).toBeUndefined();
        expect(stripped.model).toBe('phi3:mini');
        expect(stripped.messages).toHaveLength(2); // original + no-tools system notice
        expect(stripped.messages[1].role).toBe('system');
        expect(stripped.messages[1].content).toContain('do not have access to any tools');

        // Capable model: tools should remain
        const requestWithToolsCapable: any = { ...requestWithTools, model: 'llama3.2' };
        const notStripped = (provider as any).stripToolsIfNeeded(requestWithToolsCapable);
        expect(notStripped.tools).toBeDefined();
        expect(notStripped.tools).toHaveLength(1);
    });

    it('should cache and reuse adapters for the same model', async () => {
        const provider = new OllamaProvider();

        // Access via private getAdapterForModel cache
        const adapter1 = (provider as any).getAdapterForModel('llama3.2');
        const adapter2 = (provider as any).getAdapterForModel('llama3.2');
        const adapter3 = (provider as any).getAdapterForModel('mistral');

        expect(adapter1).toBe(adapter2); // exact same instance
        expect(adapter1).not.toBe(adapter3); // different model
    });
});
