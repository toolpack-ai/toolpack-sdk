import { describe, it, expect, vi } from 'vitest';
import { Toolpack, ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse } from '../../src';

// Mock Custom Adapter
class MockCustomAdapter implements ProviderAdapter {
    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        return {
            content: `Mock generated for ${request.model}`,
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            finish_reason: 'stop'
        };
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        yield { delta: `Mock ` };
        yield { delta: `streamed for ` };
        yield { delta: `${request.model}` };
        yield { delta: ``, finish_reason: 'stop' };
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        return {
            embeddings: [[0.1, 0.2, 0.3]],
            usage: { prompt_tokens: 5, total_tokens: 5 }
        };
    }
}

describe('Custom Provider Adapters', () => {

    it('should register custom provider via init config', async () => {
        const mockAdapter = new MockCustomAdapter();
        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test-key',
            customProviders: {
                'my-custom': mockAdapter
            },
            defaultMode: 'default'
        });

        // Verify registration
        const registered = sdk.getClient().getProvider('my-custom');
        expect(registered).toBe(mockAdapter);
    });

    it('should allow customProviders-only init', async () => {
        const mockAdapter = new MockCustomAdapter();
        const sdk = await Toolpack.init({
            customProviders: {
                'my-custom': mockAdapter
            },
            defaultMode: 'default'
        });

        const registered = sdk.getClient().getProvider('my-custom');
        expect(registered).toBe(mockAdapter);

        // Output from default provider should work
        const res = await sdk.generate('test');
        expect(res.content).toBe('Mock generated for '); // No model provided in string request
    });

    it('should support array syntax for customProviders', async () => {
        const mockAdapter = new MockCustomAdapter();
        mockAdapter.name = 'array-custom';

        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test-key',
            customProviders: [mockAdapter],
            defaultMode: 'default'
        });

        const registered = sdk.getClient().getProvider('array-custom');
        expect(registered).toBe(mockAdapter);
    });

    it('should throw error if array adapter missing name', async () => {
        const mockAdapter = new MockCustomAdapter();
        // Don't set name

        await expect(Toolpack.init({
            customProviders: [mockAdapter],
            defaultMode: 'default'
        })).rejects.toThrowError(/must have a 'name' property/);
    });

    it('should throw error on initialization with missing providers', async () => {
        await expect(Toolpack.init({})).rejects.toThrowError(/No provider specified/);
    });

    it('should throw error on name collision with built-in provider via customProviders', async () => {
        // Technically this tests if we try to override an already registered provider in the same init
        const mockAdapter = new MockCustomAdapter();

        await expect(Toolpack.init({
            provider: 'openai',
            apiKey: 'test',
            customProviders: {
                'openai': mockAdapter // Collision!
            },
            defaultMode: 'default'
        })).rejects.toThrowError(/conflicts with a built-in provider/);
    });

    it('should throw error if custom provider missing required methods', async () => {
        const badAdapter = {
            generate: async () => ({})
            // Missing stream and embed
        } as unknown as ProviderAdapter;

        await expect(Toolpack.init({
            customProviders: {
                'bad-custom': badAdapter
            },
            defaultMode: 'default'
        })).rejects.toThrowError(/must implement the ProviderAdapter interface/);
    });

    it('should use custom provider in generate() when passing providerName', async () => {
        const mockAdapter = new MockCustomAdapter();
        const spyGenerate = vi.spyOn(mockAdapter, 'generate');

        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test-key',
            customProviders: {
                'custom-gen': mockAdapter
            },
            defaultMode: 'default'
        });

        const res = await sdk.generate({
            messages: [{ role: 'user', content: 'hello' }],
            model: 'test-model'
        }, 'custom-gen');

        expect(spyGenerate).toHaveBeenCalledOnce();
        expect(res.content).toBe('Mock generated for test-model');
    });

    it('should use custom provider in stream() when passing providerName', async () => {
        const mockAdapter = new MockCustomAdapter();
        const spyStream = vi.spyOn(mockAdapter, 'stream');

        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test-key',
            customProviders: {
                'custom-stream': mockAdapter
            },
            defaultMode: 'default'
        });

        const stream = sdk.stream({
            messages: [{ role: 'user', content: 'hello' }],
            model: 'test-stream-model'
        }, 'custom-stream');

        let out = '';
        for await (const chunk of stream) {
            out += chunk.delta;
        }

        expect(spyStream).toHaveBeenCalledOnce();
        expect(out).toBe('Mock streamed for test-stream-model');
    });

    it('should use custom provider in embed() when passing providerName', async () => {
        const mockAdapter = new MockCustomAdapter();
        const spyEmbed = vi.spyOn(mockAdapter, 'embed');

        const sdk = await Toolpack.init({
            customProviders: {
                'custom-embed': mockAdapter
            },
            defaultMode: 'default'
        });

        const res = await sdk.embed({
            input: 'hello',
            model: 'test-embed-model'
        }, 'custom-embed');

        expect(spyEmbed).toHaveBeenCalledOnce();
        expect(res.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    });

    it('should support runtime registration via getClient().registerProvider', async () => {
        const sdk = await Toolpack.init({
            provider: 'openai',
            apiKey: 'test-key',
            defaultMode: 'default'
        });

        const mockAdapter = new MockCustomAdapter();
        sdk.getClient().registerProvider('runtime-custom', mockAdapter);

        // Usage
        const res = await sdk.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'runtime-model'
        }, 'runtime-custom');

        expect(res.content).toBe('Mock generated for runtime-model');
    });
});
