import { describe, it, expect, vi } from 'vitest';
import { AIClient } from '../../src/client';
import { ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse } from '../../src/providers/base';
import { ToolRegistry } from '../../src/tools/registry';
import { ToolDefinition, DEFAULT_TOOL_SEARCH_CONFIG, DEFAULT_TOOLS_CONFIG } from '../../src/tools/types';

// A simple mock provider that just returns the received request so we can inspect it
class MockProvider extends ProviderAdapter {
    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        // Return the request serialized in the content so we can inspect it
        return {
            content: JSON.stringify(request),
        };
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        yield { delta: JSON.stringify(request) };
        yield { delta: '', finish_reason: 'stop' };
    }
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        return { embeddings: [] };
    }
}

function makeTestTool(name: string, category: string, description: string): ToolDefinition {
    return {
        name,
        displayName: name,
        description,
        category,
        parameters: {
            type: 'object',
            properties: {},
        },
        execute: async () => '',
    };
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
            description: 'Test mode',
            systemPrompt: 'Only me.',
            baseContext: false,
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
            description: 'Test mode',
            systemPrompt: 'Hello.',
            baseContext: { includeWorkingDirectory: false, includeToolCategories: true },
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
            description: 'Test mode',
            systemPrompt: 'Hello.',
            baseContext: { custom: 'Custom built base context entirely.' },
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

        expect(systemMessage.content).not.toContain('Working directory:');
        expect(systemMessage.content).toContain('Custom built base context entirely.');
        expect(systemMessage.content).toContain('Hello.');
    });

    it('should inject request-tool guidance and strip requestTools from provider payload', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
            disableBaseContext: true,
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'test' }],
            model: 'test-model',
            requestTools: [
                {
                    name: 'knowledge_search',
                    displayName: 'Knowledge Search',
                    description: 'Search the knowledge base',
                    category: 'search',
                    parameters: {
                        type: 'object',
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    },
                    execute: vi.fn(),
                },
                {
                    name: 'conversation_search',
                    displayName: 'Conversation Search',
                    description: 'Search earlier conversation',
                    category: 'search',
                    parameters: {
                        type: 'object',
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    },
                    execute: vi.fn(),
                },
            ],
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage).toBeDefined();
        expect(systemMessage.content).toContain('knowledge_search');
        expect(systemMessage.content).toContain('conversation_search');
        expect(request.requestTools).toBeUndefined();
        expect(request.tools).toHaveLength(2);
    });

    it('should not duplicate guidance when marker is already present', async () => {
        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
        });

        const response = await client.generate({
            messages: [
                { 
                    role: 'system', 
                    content: 'Existing prompt.\n\n<!-- TOOLPACK_REQUEST_TOOL_GUIDANCE -->\nKnowledge Base:\n- Use `knowledge_search` when you need factual or domain-specific information that may already be stored.'
                },
                { role: 'user', content: 'test' }
            ],
            model: 'test-model',
            requestTools: [
                {
                    name: 'knowledge_search',
                    displayName: 'Knowledge Search',
                    description: 'Search knowledge',
                    category: 'search',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query' },
                        },
                        required: ['query'],
                    },
                    execute: async () => ({}),
                },
            ],
        });

        const request = JSON.parse(response.content || '{}');
        const systemMessage = request.messages.find((m: any) => m.role === 'system');

        expect(systemMessage).toBeDefined();
        
        // Count occurrences of the marker - should only appear once
        const markerCount = (systemMessage.content.match(/<!-- TOOLPACK_REQUEST_TOOL_GUIDANCE -->/g) || []).length;
        expect(markerCount).toBe(1);
        
        // Count occurrences of "Knowledge Base:" - should only appear once
        const knowledgeBaseCount = (systemMessage.content.match(/Knowledge Base:/g) || []).length;
        expect(knowledgeBaseCount).toBe(1);
    });

    it('should keep tool.search available when mode restricts allowedToolCategories', async () => {
        const registry = new ToolRegistry();
        registry.register(makeTestTool('web.search', 'network', 'Search the web for current information'));
        registry.register(makeTestTool('fs.read_file', 'filesystem', 'Read local files'));

        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
            disableBaseContext: true,
            toolRegistry: registry,
            toolsConfig: {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: {
                    ...DEFAULT_TOOL_SEARCH_CONFIG,
                    enabled: true,
                    alwaysLoadedTools: [],
                    alwaysLoadedCategories: [],
                },
            },
        });

        client.setMode({
            name: 'network-only',
            displayName: 'Network Only',
            description: 'Only network tools should be callable',
            systemPrompt: 'Use tools when needed.',
            allowedTools: [],
            blockedTools: [],
            allowedToolCategories: ['network'],
            blockedToolCategories: [],
            blockAllTools: false,
            toolSearch: { enabled: true },
        });

        const response = await client.generate({
            messages: [{ role: 'user', content: 'What is the news today?' }],
            model: 'test-model',
        });

        const request = JSON.parse(response.content || '{}');
        const toolNames = (request.tools || []).map((tool: any) => tool.function.name);

        expect(toolNames).toContain('tool.search');
    });

    it('should make tool.search results respect mode allowed categories', () => {
        const registry = new ToolRegistry();
        registry.register(makeTestTool('web.search', 'network', 'Search the web for headlines and current news'));
        registry.register(makeTestTool('fs.read_file', 'filesystem', 'Read files from disk and local folders'));

        const client = new AIClient({
            providers: { mock: new MockProvider() },
            defaultProvider: 'mock',
            disableBaseContext: true,
            toolRegistry: registry,
            toolsConfig: {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: {
                    ...DEFAULT_TOOL_SEARCH_CONFIG,
                    enabled: true,
                    alwaysLoadedTools: [],
                    alwaysLoadedCategories: [],
                },
            },
        });

        client.setMode({
            name: 'network-only',
            displayName: 'Network Only',
            description: 'Only network tools should be searchable',
            systemPrompt: 'Use tools when needed.',
            allowedTools: [],
            blockedTools: [],
            allowedToolCategories: ['network'],
            blockedToolCategories: [],
            blockAllTools: false,
            toolSearch: { enabled: true },
        });

        const raw = (client as any).executeToolSearch({ query: 'search files and news' });
        const parsed = JSON.parse(raw);
        const resultNames = parsed.tools.map((tool: any) => tool.name);
        const resultCategories = parsed.tools.map((tool: any) => tool.category);

        expect(resultNames).toContain('web.search');
        expect(resultNames).not.toContain('fs.read_file');
        expect(resultCategories.every((category: string) => category === 'network')).toBe(true);
    });
});
