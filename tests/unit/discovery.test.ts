import { describe, it, expect, vi } from 'vitest';
import { Toolpack, ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse, ProviderModelInfo } from '../../src';
import { OpenAIAdapter } from '../../src/providers/openai';
import { AnthropicAdapter } from '../../src/providers/anthropic';
import { GeminiAdapter } from '../../src/providers/gemini';
import { OllamaAdapter } from '../../src/providers/ollama';

// Mock Custom Adapter without overrides
class BasicCustomAdapter extends ProviderAdapter {
    async generate() { return {} as any; }
    async *stream() { yield {} as any; }
    async embed() { return {} as any; }
}

// Mock Custom Adapter with overrides
class AdvancedCustomAdapter extends ProviderAdapter {
    name = 'advanced';

    getDisplayName(): string {
        return 'Advanced Custom';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        return [{
            id: 'adv-model',
            displayName: 'Adv Model',
            capabilities: { chat: true, streaming: false, toolCalling: false, embeddings: false, vision: false }
        }];
    }

    async generate() { return {} as any; }
    async *stream() { yield {} as any; }
    async embed() { return {} as any; }
}

// Mock Custom Adapter that throws in getModels
class ThrowingCustomAdapter extends ProviderAdapter {
    name = 'throwing';

    async getModels(): Promise<ProviderModelInfo[]> {
        throw new Error('API down');
    }

    async generate() { return {} as any; }
    async *stream() { yield {} as any; }
    async embed() { return {} as any; }
}

describe('Provider and Model Discovery', () => {

    it('getModels() returns correct structure for built-in API adapters', async () => {
        const openai = new OpenAIAdapter('test');
        const anthropic = new AnthropicAdapter('test');
        const gemini = new GeminiAdapter('test');

        const openaiModels = await openai.getModels();
        expect(openaiModels.length).toBeGreaterThan(0);
        expect(openaiModels[0]).toHaveProperty('id');
        expect(openaiModels[0]).toHaveProperty('displayName');

        const anthropicModels = await anthropic.getModels();
        expect(anthropicModels.length).toBeGreaterThan(0);

        const geminiModels = await gemini.getModels();
        expect(geminiModels.length).toBeGreaterThan(0);
    });

    it('OllamaAdapter.getModels() maps from OllamaModelInfo correctly', async () => {
        const ollama = new OllamaAdapter({ model: 'llama3' });
        // Mock listModels
        ollama.listModels = vi.fn().mockResolvedValue([
            { name: 'llama3:latest', size: 123, digest: 'abc', modified_at: 'now' }
        ]);

        const models = await ollama.getModels();
        expect(models).toHaveLength(1);
        expect(models[0].id).toBe('llama3:latest');
        expect(models[0].displayName).toBe('llama3:latest');
        expect(models[0].capabilities.chat).toBe(true);
    });

    it('custom adapter with no getModels() override returns []', async () => {
        const adapter = new BasicCustomAdapter();
        const models = await adapter.getModels();
        expect(models).toEqual([]);
        expect(adapter.getDisplayName()).toBe('BasicCustom');
    });

    it('custom adapter with getDisplayName() override appears correctly', async () => {
        const adapter = new AdvancedCustomAdapter();
        expect(adapter.getDisplayName()).toBe('Advanced Custom');
        const models = await adapter.getModels();
        expect(models).toHaveLength(1);
        expect(models[0].id).toBe('adv-model');
    });

    it('listProviders() includes both built-in and custom providers', async () => {
        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test',
            customProviders: [new AdvancedCustomAdapter()],
            defaultMode: 'default'
        });

        const providers = await sdk.listProviders();
        expect(providers.length).toBe(2);

        const openAi = providers.find(p => p.name === 'openai');
        expect(openAi).toBeDefined();
        expect(openAi?.type).toBe('built-in');

        const adv = providers.find(p => p.name === 'advanced');
        expect(adv).toBeDefined();
        expect(adv?.type).toBe('custom');
        expect(adv?.displayName).toBe('Advanced Custom');
    });

    it('listModels() flat list includes provider name', async () => {
        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test',
            customProviders: [new AdvancedCustomAdapter()],
            defaultMode: 'default'
        });

        const models = await sdk.listModels();
        expect(models.length).toBeGreaterThan(0);

        // Find the advanced custom model
        const advModel = models.find(m => m.id === 'adv-model');
        expect(advModel).toBeDefined();
        expect(advModel?.provider).toBe('advanced');

        // Find an openai model
        const gpt4o = models.find(m => m.id === 'gpt-4.1');
        expect(gpt4o).toBeDefined();
        expect(gpt4o?.provider).toBe('openai');
    });

    it('provider that throws in getModels() is handled gracefully in listProviders', async () => {
        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test',
            customProviders: [new ThrowingCustomAdapter()],
            defaultMode: 'default'
        });

        const providers = await sdk.listProviders();
        const throwing = providers.find(p => p.name === 'throwing');
        expect(throwing).toBeDefined();
        expect(throwing?.models).toEqual([]);
    });

});
