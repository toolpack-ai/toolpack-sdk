import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('OpenRouterAdapter', () => {
    let OpenRouterAdapter: any;
    let mockCreate: any;

    beforeEach(async () => {
        vi.resetModules();

        mockCreate = vi.fn();
        vi.doMock('openai', () => {
            class MockOpenAI {
                chat = { completions: { create: mockCreate } };
                embeddings = { create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 5, total_tokens: 5 } }) };
                static APIError = class APIError extends Error {
                    status: number;
                    constructor(status: number, message: string) {
                        super(message);
                        this.status = status;
                    }
                };
            }
            return { default: MockOpenAI };
        });

        vi.doMock('../../src/providers/provider-logger', () => ({
            log: vi.fn(),
            logError: vi.fn(),
            logWarn: vi.fn(),
            logInfo: vi.fn(),
            logDebug: vi.fn(),
            logTrace: vi.fn(),
            safePreview: vi.fn((v: any) => String(v).slice(0, 50)),
            logMessagePreview: vi.fn(),
            isVerbose: vi.fn(() => false),
            shouldLog: vi.fn(() => true),
            getLogLevel: vi.fn(() => 3),
        }));

        const mod = await import('../../src/providers/openrouter/index');
        OpenRouterAdapter = mod.OpenRouterAdapter;
    });

    describe('identity', () => {
        it('should have name = openrouter', () => {
            const adapter = new OpenRouterAdapter('test-key');
            expect(adapter.name).toBe('openrouter');
        });

        it('should have display name OpenRouter', () => {
            const adapter = new OpenRouterAdapter('test-key');
            expect(adapter.getDisplayName()).toBe('OpenRouter');
        });

        it('supportsFileUpload() should be false', () => {
            const adapter = new OpenRouterAdapter('test-key');
            expect(adapter.supportsFileUpload()).toBe(false);
        });
    });

    describe('generate()', () => {
        it('should convert response to CompletionResponse format', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Hello from OpenRouter!', tool_calls: null },
                    finish_reason: 'stop',
                }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            });

            const adapter = new OpenRouterAdapter('test-key');
            const response = await adapter.generate({
                messages: [{ role: 'user', content: 'Hi' }],
                model: 'anthropic/claude-sonnet-4-6',
            });

            expect(response.content).toBe('Hello from OpenRouter!');
            expect(response.finish_reason).toBe('stop');
            expect(response.usage?.total_tokens).toBe(15);
        });

        it('should handle tool calls in response', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: {
                        content: null,
                        tool_calls: [{
                            id: 'call_abc',
                            function: { name: 'fs_read_file', arguments: '{"path":"/test.txt"}' },
                        }],
                    },
                    finish_reason: 'tool_calls',
                }],
                usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
            });

            const adapter = new OpenRouterAdapter('test-key');
            const response = await adapter.generate({
                messages: [{ role: 'user', content: 'Read test.txt' }],
                model: 'openai/gpt-4.1',
                tools: [{
                    type: 'function',
                    function: { name: 'fs.read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
                }],
            });

            expect(response.tool_calls).toHaveLength(1);
            expect(response.tool_calls![0].id).toBe('call_abc');
            expect(response.tool_calls![0].name).toBe('fs.read_file');
            expect(response.tool_calls![0].arguments).toEqual({ path: '/test.txt' });
        });
    });

    describe('stream()', () => {
        it('should yield text deltas', async () => {
            const chunks = [
                { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }], usage: null },
                { choices: [{ delta: { content: 'world' }, finish_reason: null }], usage: null },
                { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
            ];

            mockCreate.mockResolvedValue({
                [Symbol.asyncIterator]: async function* () {
                    for (const c of chunks) yield c;
                },
            });

            const adapter = new OpenRouterAdapter('test-key');
            const results: any[] = [];
            for await (const chunk of adapter.stream({
                messages: [{ role: 'user', content: 'Hi' }],
                model: 'meta-llama/llama-3.3-70b-instruct',
            })) {
                results.push(chunk);
            }

            const text = results.filter(c => c.delta).map(c => c.delta).join('');
            expect(text).toBe('Hello world');

            const stopChunk = results.find(c => c.finish_reason === 'stop');
            expect(stopChunk).toBeDefined();
        });
    });

    describe('getModels()', () => {
        it('should fetch and map models from OpenRouter API', async () => {
            const mockModels = {
                data: [
                    {
                        id: 'anthropic/claude-sonnet-4-6',
                        name: 'Claude Sonnet 4.6',
                        context_length: 200000,
                        architecture: { modality: 'text+image->text' },
                        pricing: { prompt: '0.000003' },
                        top_provider: { max_completion_tokens: 8192 },
                    },
                    {
                        id: 'meta-llama/llama-3.3-70b-instruct',
                        name: 'Llama 3.3 70B Instruct',
                        context_length: 131072,
                        architecture: { modality: 'text->text' },
                        pricing: { prompt: '0.00000059' },
                        top_provider: { max_completion_tokens: 32768 },
                    },
                ],
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockModels,
            });

            const adapter = new OpenRouterAdapter('test-key');
            const models = await adapter.getModels();

            expect(models).toHaveLength(2);

            const claude = models.find(m => m.id === 'anthropic/claude-sonnet-4-6')!;
            expect(claude.displayName).toBe('Claude Sonnet 4.6');
            expect(claude.capabilities.vision).toBe(true);
            expect(claude.contextWindow).toBe(200000);
            expect(claude.costTier).toBe('medium'); // $3/1M

            const llama = models.find(m => m.id === 'meta-llama/llama-3.3-70b-instruct')!;
            expect(llama.capabilities.vision).toBe(false);
            expect(llama.costTier).toBe('low');
        });

        it('should return empty array when fetch fails', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

            const adapter = new OpenRouterAdapter('test-key');
            const models = await adapter.getModels();
            expect(models).toEqual([]);
        });

        it('should return empty array on non-ok response', async () => {
            global.fetch = vi.fn().mockResolvedValue({ ok: false });

            const adapter = new OpenRouterAdapter('test-key');
            const models = await adapter.getModels();
            expect(models).toEqual([]);
        });
    });

    describe('deriveCostTier (via getModels)', () => {
        it.each([
            ['0.0000001', 'low'],      // $0.10 / 1M
            ['0.0000009', 'low'],      // $0.90 / 1M — just under $1 threshold
            ['0.000001', 'medium'],    // $1.00 / 1M — hits medium tier
            ['0.000003', 'medium'],    // $3.00 / 1M
            ['0.000004', 'medium'],    // $4.00 / 1M — just under $5 threshold
            ['0.000005', 'high'],      // $5.00 / 1M — hits high tier
            ['0.000015', 'high'],      // $15.00 / 1M
            ['0.00002', 'premium'],    // $20.00 / 1M — hits premium tier
            ['0.0001', 'premium'],     // $100.00 / 1M
        ])('pricing.prompt=%s → costTier=%s', async (prompt, expectedTier) => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: [{ id: 'test/model', name: 'Test', context_length: 4096, architecture: { modality: 'text->text' }, pricing: { prompt } }],
                }),
            });

            const adapter = new OpenRouterAdapter('test-key');
            const [model] = await adapter.getModels();
            expect(model.costTier).toBe(expectedTier);
        });
    });
});
