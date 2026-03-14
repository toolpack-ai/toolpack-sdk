import { describe, it, expect, vi } from 'vitest';
import { AIClient } from '../../src/client';
import { ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse } from '../../src/providers/base';

// A simple mock provider that just returns the received request so we can inspect it
class MockProvider implements ProviderAdapter {
    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        // Return the request serialized in the content so we can inspect it
        return {
            content: JSON.stringify(request),
        };
    }
    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        yield { delta: JSON.stringify(request) };
        yield { finish_reason: 'stop' };
    }
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        return { embeddings: [] };
    }
}

describe('AIClient - System Prompt Injection', () => {
    it('should inject Base Agent Context by default', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage).toBeDefined();
        expect(systemMessage.content).toContain('Working directory:');
        expect(systemMessage.content).toContain('be proactive');
    });

    it('should inject Override System Prompt', async () => {
        const customPrompt = 'You are a test override persona.';
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
            systemPrompt: customPrompt,
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage).toBeDefined();
        // Base context comes before override
        expect(systemMessage.content).toContain('Working directory:');
        expect(systemMessage.content).toContain(customPrompt);

        // Ensure order: Base -> Override
        const indexOfBase = systemMessage.content.indexOf('Working directory:');
        const indexOfOverride = systemMessage.content.indexOf(customPrompt);
        expect(indexOfBase).toBeGreaterThan(-1);
        expect(indexOfOverride).toBeGreaterThan(-1);
        expect(indexOfBase).toBeLessThan(indexOfOverride);
    });

    it('should disable Base Context when configured', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
            disableBaseContext: true,
            systemPrompt: 'Only this should be here.',
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage).toBeDefined();
        expect(systemMessage.content).not.toContain('Working directory:');
        expect(systemMessage.content).not.toContain('Be proactive');
        expect(systemMessage.content).toContain('Only this should be here.');
    });

    it('should inject Mode System Prompt', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
            disableBaseContext: true, // isolate the test
        });

        client.setMode({
            name: 'test-mode',
            displayName: 'Test',
            description: 'Test mode',
            systemPrompt: 'Mode prompt here.',
            allowedTools: [],
            blockedTools: [],
            allowedToolCategories: [],
            blockedToolCategories: [],
            blockAllTools: false,
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage).toBeDefined();
        expect(systemMessage.content).toContain('Mode prompt here.');
    });

    it('should respect mode baseContext: false', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
        });

        client.setMode({
            name: 'no-context',
            displayName: 'Test',
            systemPrompt: 'Only me.',
            baseContext: false,
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage.content).not.toContain('Working directory:');
        expect(systemMessage.content).not.toContain('be proactive');
        expect(systemMessage.content).toContain('Only me.');
    });

    it('should respect mode baseContext.includeWorkingDirectory', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
        });

        client.setMode({
            name: 'no-wd',
            displayName: 'Test',
            systemPrompt: 'Hello.',
            baseContext: { includeWorkingDirectory: false, includeToolCategories: true },
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage.content).not.toContain('Working directory:');
        expect(systemMessage.content).toContain('be proactive');
    });

    it('should respect mode baseContext.custom overrides', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
        });

        client.setMode({
            name: 'custom-ctx',
            displayName: 'Test',
            systemPrompt: 'Hello.',
            baseContext: { custom: 'Custom built base context entirely.' },
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage.content).not.toContain('Working directory:');
        expect(systemMessage.content).toContain('Custom built base context entirely.');
        expect(systemMessage.content).toContain('Hello.');
    });
});
