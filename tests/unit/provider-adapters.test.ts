import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for Anthropic and Gemini provider adapters.
 * Tests message format conversion, tool call handling, tool name sanitization,
 * streaming, and error mapping — all with mocked API clients.
 */

// =============================================================================
// Anthropic Adapter Tests
// =============================================================================

describe('AnthropicAdapter', () => {
    let AnthropicAdapter: any;
    let mockCreate: any;

    beforeEach(async () => {
        // Reset mocks
        vi.resetModules();

        // Mock the Anthropic SDK
        mockCreate = vi.fn();
        vi.doMock('@anthropic-ai/sdk', () => {
            class MockAnthropic {
                messages = { create: mockCreate };
                static APIError = class APIError extends Error {
                    status: number;
                    constructor(status: number, message: string) {
                        super(message);
                        this.status = status;
                    }
                };
            }
            return { default: MockAnthropic };
        });

        // Mock the provider-logger to avoid file writes during tests
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
            getLogLevel: vi.fn(() => 3), // 3 corresponds to 'debug' level
        }));

        const mod = await import('../../src/providers/anthropic/index');
        AnthropicAdapter = mod.AnthropicAdapter;
    });

    describe('generate()', () => {
        it('should convert response to CompletionResponse format', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: 'Hello from Claude!' }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'end_turn',
            });

            const adapter = new AnthropicAdapter('test-key');
            const response = await adapter.generate({
                messages: [{ role: 'user', content: 'Hi' }],
                model: 'claude-sonnet-4-20250514',
            });

            expect(response.content).toBe('Hello from Claude!');
            expect(response.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
            expect(response.finish_reason).toBe('stop');
        });

        it('should handle tool_use blocks in response', async () => {
            mockCreate.mockResolvedValue({
                content: [
                    { type: 'text', text: 'Let me check.' },
                    { type: 'tool_use', id: 'toolu_123', name: 'fs_read_file', input: { path: '/test.txt' } },
                ],
                usage: { input_tokens: 20, output_tokens: 15 },
                stop_reason: 'tool_use',
            });

            const adapter = new AnthropicAdapter('test-key');
            const response = await adapter.generate({
                messages: [{ role: 'user', content: 'Read test.txt' }],
                model: 'claude-sonnet-4-20250514',
                tools: [{
                    type: 'function',
                    function: { name: 'fs.read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
                }],
            });

            expect(response.content).toBe('Let me check.');
            expect(response.tool_calls).toHaveLength(1);
            expect(response.tool_calls![0].id).toBe('toolu_123');
            // Tool name should be restored from sanitized 'fs_read_file' back to 'fs.read_file'
            expect(response.tool_calls![0].name).toBe('fs.read_file');
            expect(response.tool_calls![0].arguments).toEqual({ path: '/test.txt' });
        });

        it('should sanitize tool names (dots to underscores) in request', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: 'OK' }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'end_turn',
            });

            const adapter = new AnthropicAdapter('test-key');
            await adapter.generate({
                messages: [{ role: 'user', content: 'test' }],
                model: 'claude-sonnet-4-20250514',
                tools: [{
                    type: 'function',
                    function: { name: 'fs.read_file', description: 'Read', parameters: {} },
                }],
            });

            const callArgs = mockCreate.mock.calls[0][0];
            expect(callArgs.tools[0].name).toBe('fs_read_file');
        });

        it('should map tool_choice correctly', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: 'OK' }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'end_turn',
            });

            const adapter = new AnthropicAdapter('test-key');
            const tools = [{
                type: 'function' as const,
                function: { name: 'test', description: 'test', parameters: {} },
            }];

            // tool_choice: auto
            await adapter.generate({ messages: [{ role: 'user', content: 'test' }], model: 'test', tools, tool_choice: 'auto' });
            expect(mockCreate.mock.calls[0][0].tool_choice).toEqual({ type: 'auto' });

            // tool_choice: required → 'any' for Anthropic
            await adapter.generate({ messages: [{ role: 'user', content: 'test' }], model: 'test', tools, tool_choice: 'required' });
            expect(mockCreate.mock.calls[1][0].tool_choice).toEqual({ type: 'any' });

            // tool_choice: none → delete tools from params
            await adapter.generate({ messages: [{ role: 'user', content: 'test' }], model: 'test', tools, tool_choice: 'none' });
            expect(mockCreate.mock.calls[2][0].tools).toBeUndefined();
        });

        it('should default max_tokens to 4096', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: 'OK' }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'end_turn',
            });

            const adapter = new AnthropicAdapter('test-key');
            await adapter.generate({
                messages: [{ role: 'user', content: 'test' }],
                model: 'test',
            });

            expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096);
        });

        it('should convert tool result messages to tool_result content blocks', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: 'Done' }],
                usage: { input_tokens: 20, output_tokens: 5 },
                stop_reason: 'end_turn',
            });

            const adapter = new AnthropicAdapter('test-key');
            await adapter.generate({
                messages: [
                    { role: 'user', content: 'Read file' },
                    {
                        role: 'assistant',
                        content: '',
                        tool_calls: [{
                            id: 'toolu_123',
                            type: 'function' as const,
                            function: { name: 'fs.read_file', arguments: '{"path": "/test.txt"}' },
                        }],
                    },
                    { role: 'tool', content: 'file contents here', tool_call_id: 'toolu_123' },
                ],
                model: 'test',
            });

            const sentMessages = mockCreate.mock.calls[0][0].messages;

            // assistant message with tool_calls should be converted to tool_use content blocks
            const assistantMsg = sentMessages.find((m: any) => m.role === 'assistant');
            expect(assistantMsg).toBeDefined();
            expect(assistantMsg.content).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: 'tool_use', id: 'toolu_123', name: 'fs_read_file' }),
                ])
            );

            // tool result should be a user message with tool_result content block
            const toolResultMsg = sentMessages.find((m: any) =>
                m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
            );
            expect(toolResultMsg).toBeDefined();
            expect(toolResultMsg.content[0].tool_use_id).toBe('toolu_123');
            expect(toolResultMsg.content[0].content).toBe('file contents here');
        });
    });

    describe('stream()', () => {
        it('should yield text deltas and tool calls from stream events', async () => {
            // Simulate Anthropic streaming events
            const events = [
                { type: 'content_block_start', content_block: { type: 'text', text: '' } },
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
                { type: 'content_block_stop' },
                { type: 'content_block_start', content_block: { type: 'tool_use', id: 'toolu_456', name: 'fs_list_dir' } },
                { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"pa' } },
                { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'th": "."}' } },
                { type: 'content_block_stop' },
                { type: 'message_stop' },
            ];

            mockCreate.mockResolvedValue({
                [Symbol.asyncIterator]: async function* () {
                    for (const e of events) yield e;
                },
            });

            const adapter = new AnthropicAdapter('test-key');
            const chunks: any[] = [];
            for await (const chunk of adapter.stream({
                messages: [{ role: 'user', content: 'List files' }],
                model: 'claude-sonnet-4-20250514',
                tools: [{
                    type: 'function',
                    function: { name: 'fs.list_dir', description: 'List dir', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
                }],
            })) {
                chunks.push(chunk);
            }

            // Text chunks
            const textChunks = chunks.filter(c => c.delta && c.delta !== '');
            expect(textChunks.map(c => c.delta).join('')).toBe('Hello world');

            // Tool call chunk
            const toolChunks = chunks.filter(c => c.finish_reason === 'tool_calls');
            expect(toolChunks).toHaveLength(1);
            expect(toolChunks[0].tool_calls[0].id).toBe('toolu_456');
            expect(toolChunks[0].tool_calls[0].name).toBe('fs.list_dir');
            expect(toolChunks[0].tool_calls[0].arguments).toEqual({ path: '.' });

            // Stop chunk
            const stopChunks = chunks.filter(c => c.finish_reason === 'stop');
            expect(stopChunks).toHaveLength(1);
        });
    });

    describe('getModels() and getDisplayName()', () => {
        it('should return curated model list', async () => {
            const adapter = new AnthropicAdapter('test-key');
            const models = await adapter.getModels();
            expect(models.length).toBeGreaterThanOrEqual(3);
            expect(models[0].id).toBe('claude-haiku-4-5-20251001');
            expect(models[0].capabilities.toolCalling).toBe(true);
            expect(models[0].capabilities.embeddings).toBe(false);
        });

        it('should return display name', () => {
            const adapter = new AnthropicAdapter('test-key');
            expect(adapter.getDisplayName()).toBe('Anthropic');
        });
    });

    describe('embed()', () => {
        it('should throw InvalidRequestError', async () => {
            const adapter = new AnthropicAdapter('test-key');
            await expect(adapter.embed({ input: 'test', model: 'test' })).rejects.toThrow(/not strictly supported/i);
        });
    });

    describe('finish_reason mapping', () => {
        it('should map end_turn to stop', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: 'OK' }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'end_turn',
            });
            const adapter = new AnthropicAdapter('test-key');
            const res = await adapter.generate({ messages: [{ role: 'user', content: 'test' }], model: 'test' });
            expect(res.finish_reason).toBe('stop');
        });

        it('should map max_tokens to length', async () => {
            mockCreate.mockResolvedValue({
                content: [{ type: 'text', text: 'OK' }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'max_tokens',
            });
            const adapter = new AnthropicAdapter('test-key');
            const res = await adapter.generate({ messages: [{ role: 'user', content: 'test' }], model: 'test' });
            expect(res.finish_reason).toBe('length');
        });
    });
});

// =============================================================================
// Gemini Adapter Tests
// =============================================================================

describe('GeminiAdapter', () => {
    let GeminiAdapter: any;
    let mockSendMessage: any;
    let mockSendMessageStream: any;
    let mockStartChat: any;
    let mockGetGenerativeModel: any;
    let mockEmbedContent: any;

    beforeEach(async () => {
        vi.resetModules();

        mockSendMessage = vi.fn();
        mockSendMessageStream = vi.fn();
        mockEmbedContent = vi.fn();

        mockStartChat = vi.fn().mockReturnValue({
            sendMessage: mockSendMessage,
            sendMessageStream: mockSendMessageStream,
        });

        mockGetGenerativeModel = vi.fn().mockReturnValue({
            startChat: mockStartChat,
            embedContent: mockEmbedContent,
        });

        vi.doMock('@google/generative-ai', () => {
            return {
                GoogleGenerativeAI: class {
                    getGenerativeModel = mockGetGenerativeModel;
                },
            };
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
            getLogLevel: vi.fn(() => 3), // 3 corresponds to 'debug' level
        }));

        const mod = await import('../../src/providers/gemini/index');
        GeminiAdapter = mod.GeminiAdapter;
    });

    describe('generate()', () => {
        it('should convert response to CompletionResponse format', async () => {
            mockSendMessage.mockResolvedValue({
                response: {
                    candidates: [{
                        content: {
                            parts: [{ text: 'Hello from Gemini!' }],
                        },
                    }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8, totalTokenCount: 18 },
                },
            });

            const adapter = new GeminiAdapter('test-key');
            const response = await adapter.generate({
                messages: [{ role: 'user', content: 'Hi' }],
                model: 'gemini-2.0-flash',
            });

            expect(response.content).toBe('Hello from Gemini!');
            expect(response.finish_reason).toBe('stop');
        });

        it('should handle functionCall parts in response', async () => {
            mockSendMessage.mockResolvedValue({
                response: {
                    candidates: [{
                        content: {
                            parts: [
                                { functionCall: { name: 'fs_read_file', args: { path: '/test.txt' } } },
                            ],
                        },
                    }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
                },
            });

            const adapter = new GeminiAdapter('test-key');
            const response = await adapter.generate({
                messages: [{ role: 'user', content: 'Read test.txt' }],
                model: 'gemini-2.0-flash',
                tools: [{
                    type: 'function',
                    function: { name: 'fs.read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
                }],
            });

            expect(response.tool_calls).toHaveLength(1);
            expect(response.tool_calls![0].name).toBe('fs.read_file');
            expect(response.tool_calls![0].arguments).toEqual({ path: '/test.txt' });
            expect(response.tool_calls![0].id).toMatch(/^gemini_/);
            expect(response.finish_reason).toBe('tool_calls');
        });

        it('should sanitize tool names (dots to underscores) in request', async () => {
            mockSendMessage.mockResolvedValue({
                response: {
                    candidates: [{ content: { parts: [{ text: 'OK' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
                },
            });

            const adapter = new GeminiAdapter('test-key');
            await adapter.generate({
                messages: [{ role: 'user', content: 'test' }],
                model: 'gemini-2.0-flash',
                tools: [{
                    type: 'function',
                    function: { name: 'fs.read_file', description: 'Read', parameters: {} },
                }],
            });

            const modelConfig = mockGetGenerativeModel.mock.calls[0][0];
            expect(modelConfig.tools[0].functionDeclarations[0].name).toBe('fs_read_file');
        });
    });

    describe('stream()', () => {
        it('should yield text deltas and tool calls from stream', async () => {
            const streamChunks = [
                { candidates: [{ content: { parts: [{ text: 'Hello ' }] } }], text: () => 'Hello ' },
                { candidates: [{ content: { parts: [{ text: 'world' }] } }], text: () => 'world' },
                {
                    candidates: [{
                        content: {
                            parts: [{ functionCall: { name: 'fs_list_dir', args: { path: '.' } } }],
                        },
                    }],
                    text: () => { throw new Error('no text'); },
                },
            ];

            mockSendMessageStream.mockResolvedValue({
                stream: (async function* () {
                    for (const c of streamChunks) yield c;
                })(),
            });

            const adapter = new GeminiAdapter('test-key');
            const chunks: any[] = [];
            for await (const chunk of adapter.stream({
                messages: [{ role: 'user', content: 'List files' }],
                model: 'gemini-2.0-flash',
                tools: [{
                    type: 'function',
                    function: { name: 'fs.list_dir', description: 'List dir', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
                }],
            })) {
                chunks.push(chunk);
            }

            const textChunks = chunks.filter(c => c.delta && c.delta !== '');
            expect(textChunks.map(c => c.delta).join('')).toBe('Hello world');

            const toolChunks = chunks.filter(c => c.finish_reason === 'tool_calls');
            expect(toolChunks).toHaveLength(1);
            expect(toolChunks[0].tool_calls[0].name).toBe('fs.list_dir');
            expect(toolChunks[0].tool_calls[0].arguments).toEqual({ path: '.' });
        });
    });

    describe('formatHistory() — multi-round tool conversations', () => {
        it('should convert assistant tool_calls and tool results into Gemini format', async () => {
            mockSendMessage.mockResolvedValue({
                response: {
                    candidates: [{ content: { parts: [{ text: 'Done!' }] } }],
                    usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5, totalTokenCount: 35 },
                },
            });

            const adapter = new GeminiAdapter('test-key');
            await adapter.generate({
                messages: [
                    { role: 'user', content: 'Read file' },
                    {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'gemini_123_abc',
                            type: 'function' as const,
                            function: { name: 'fs.read_file', arguments: '{"path": "/test.txt"}' },
                        }],
                    },
                    { role: 'tool', content: 'file contents here', tool_call_id: 'gemini_123_abc', name: 'fs.read_file' },
                    { role: 'user', content: 'What does it say?' },
                ],
                model: 'gemini-2.0-flash',
            });

            // Check the history passed to startChat
            const chatHistory = mockStartChat.mock.calls[0][0].history;

            // First: user message
            expect(chatHistory[0].role).toBe('user');
            expect(chatHistory[0].parts[0].text).toBe('Read file');

            // Second: assistant (model) with functionCall
            expect(chatHistory[1].role).toBe('model');
            expect(chatHistory[1].parts[0].functionCall).toBeDefined();
            expect(chatHistory[1].parts[0].functionCall.name).toBe('fs_read_file');

            // Third: tool result as functionResponse
            expect(chatHistory[2].role).toBe('function');
            expect(chatHistory[2].parts[0].functionResponse).toBeDefined();
            expect(chatHistory[2].parts[0].functionResponse.response.content).toBe('file contents here');
        });
    });

    describe('getModels() and getDisplayName()', () => {
        it('should return curated model list', async () => {
            const adapter = new GeminiAdapter('test-key');
            const models = await adapter.getModels();
            expect(models.length).toBeGreaterThanOrEqual(3);
            expect(models[0].id).toBe('gemini-3.1-flash-lite-preview');
            expect(models[0].capabilities.toolCalling).toBe(true);
        });

        it('should return display name', () => {
            const adapter = new GeminiAdapter('test-key');
            expect(adapter.getDisplayName()).toBe('Google Gemini');
        });
    });

    describe('embed()', () => {
        it('should return embeddings for a single string', async () => {
            mockEmbedContent.mockResolvedValue({
                embedding: { values: [0.1, 0.2, 0.3] },
            });

            const adapter = new GeminiAdapter('test-key');
            const res = await adapter.embed({ input: 'test', model: 'text-embedding-004' });
            expect(res.embeddings).toEqual([[0.1, 0.2, 0.3]]);
        });
    });
});
