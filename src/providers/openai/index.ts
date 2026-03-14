import OpenAI from 'openai';
import { ProviderAdapter } from '../base';
import { CompletionRequest, CompletionResponse, CompletionChunk, ToolCallResult, Message, EmbeddingRequest, EmbeddingResponse, ProviderModelInfo, FileUploadRequest, FileUploadResponse } from '../../types';
import { AuthenticationError, RateLimitError, InvalidRequestError, ProviderError } from '../../errors';
import { log, safePreview, logMessagePreview, isVerbose } from '../provider-logger';

export class OpenAIAdapter extends ProviderAdapter {
    private client: OpenAI;

    constructor(apiKey: string, baseURL?: string) {
        super();
        this.client = new OpenAI({
            apiKey,
            baseURL,
            timeout: 60000, // 60 seconds
            maxRetries: 2,
        });
    }

    supportsFileUpload(): boolean {
        return true;
    }

    async uploadFile(request: FileUploadRequest): Promise<FileUploadResponse> {
        try {
            const fs = await import('fs');
            if (!request.filePath) {
                throw new InvalidRequestError('OpenAI uploadFile requires a filePath.');
            }
            const response = await this.client.files.create({
                file: fs.createReadStream(request.filePath) as any,
                purpose: (request.purpose as any) || 'vision',
            });
            return {
                id: response.id,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async deleteFile(fileId: string): Promise<void> {
        try {
            await this.client.files.delete(fileId);
        } catch (error) {
            throw this.handleError(error);
        }
    }

    getDisplayName(): string {
        return 'OpenAI';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        return [
            {
                id: 'gpt-4.1-mini',
                displayName: 'GPT-4.1 Mini',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 1047576,
                maxOutputTokens: 32768,
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                reasoningTier: null,
                costTier: 'low',
            },
            {
                id: 'gpt-4.1',
                displayName: 'GPT-4.1',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 1047576,
                maxOutputTokens: 32768,
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                reasoningTier: null,
                costTier: 'medium',
            },
            {
                id: 'gpt-5.1',
                displayName: 'GPT-5.1',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 400000,
                maxOutputTokens: 128000,
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                reasoningTier: 'standard',   // effort: none | low | medium | high
                costTier: 'medium',
            },
            {
                id: 'gpt-5.2',
                displayName: 'GPT-5.2',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 400000,
                maxOutputTokens: 128000,
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                reasoningTier: 'standard',   // effort: none | low | medium | high | xhigh
                costTier: 'high',
            },
            {
                id: 'gpt-5.4',
                displayName: 'GPT-5.4',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 1050000,
                maxOutputTokens: 128000,
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                reasoningTier: 'standard',   // effort: none | low | medium | high | xhigh
                costTier: 'high',
            },
            {
                id: 'gpt-5.4-pro',
                displayName: 'GPT-5.4 Pro',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 1050000,
                maxOutputTokens: 128000,
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                reasoningTier: 'extended',   // effort: medium | high | xhigh only
                costTier: 'premium',
            },
        ];
    }

    /**
     * Sanitize tool name for OpenAI (replace dots with underscores)
     * OpenAI pattern: ^[a-zA-Z0-9_-]+$
     */
    private sanitizeToolName(name: string): string {
        return name.replace(/\./g, '_');
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        try {
            const requestId = (request as any).__toolpack_request_id || `gen-${Date.now()}`;
            const messages = await Promise.all(request.messages.map(msg => this.toOpenAIMessage(msg, request.mediaOptions)));
            const params: any = {
                messages: messages,
                model: request.model,
                temperature: request.temperature,
                max_tokens: request.max_tokens,
                top_p: request.top_p,
                response_format: request.response_format === 'json_object' ? { type: 'json_object' } : undefined,
                stream: false,
            };

            // Build sanitized name mapping for round-trip conversion
            const nameMapping: Map<string, string> = new Map();
            if (request.tools && request.tools.length > 0) {
                params.tools = request.tools.map(t => {
                    const sanitizedName = this.sanitizeToolName(t.function.name);
                    nameMapping.set(sanitizedName, t.function.name);
                    return {
                        type: 'function',
                        function: {
                            name: sanitizedName,
                            description: t.function.description,
                            parameters: t.function.parameters,
                        },
                    };
                });
                params.tool_choice = request.tool_choice || 'auto';
                log(`[OpenAI][${requestId}] Sending ${params.tools.length} tools with tool_choice: ${params.tool_choice}`);
                if (isVerbose()) {
                    log(`[OpenAI][${requestId}] First tool: ${safePreview(params.tools[0], 800)}`);
                }
            }

            log(`[OpenAI][${requestId}] Request params: ${safePreview({
                model: params.model,
                messages_count: params.messages.length,
                has_tools: !!params.tools,
                tools_count: params.tools?.length,
                tool_choice: params.tool_choice,
            }, 800)}`);
            logMessagePreview(requestId, 'OpenAI', params.messages);

            const completion = await this.client.chat.completions.create(
                params,
                request.signal ? { signal: request.signal } : undefined,
            );

            log(`[OpenAI][${requestId}] Raw completion: ${JSON.stringify(completion)}`);
            const responseMsg = completion.choices[0].message as any;
            log(`[OpenAI][${requestId}] Response: finish_reason=${completion.choices[0].finish_reason}`);
            log(`[OpenAI][${requestId}] Response has tool_calls: ${!!responseMsg.tool_calls}, count: ${responseMsg.tool_calls?.length || 0}`);
            log(`[OpenAI][${requestId}] Response content: ${JSON.stringify(responseMsg.content)}`);
            if (responseMsg.content) {
                log(`[OpenAI][${requestId}] Response content preview: ${safePreview(responseMsg.content, 200)}`);
            }

            const choice = completion.choices[0];
            let toolCalls: ToolCallResult[] | undefined;
            const rawToolCalls = (choice.message as any).tool_calls;
            if (rawToolCalls && rawToolCalls.length > 0) {
                toolCalls = rawToolCalls.map((tc: any) => ({
                    id: tc.id,
                    name: nameMapping.get(tc.function.name) || tc.function.name,
                    arguments: JSON.parse(tc.function.arguments),
                }));
            }

            return {
                content: choice.message.content,
                usage: completion.usage ? {
                    prompt_tokens: completion.usage.prompt_tokens,
                    completion_tokens: completion.usage.completion_tokens,
                    total_tokens: completion.usage.total_tokens,
                } : undefined,
                finish_reason: choice.finish_reason as any,
                tool_calls: toolCalls,
                raw: completion,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        try {
            const requestId = (request as any).__toolpack_request_id || `str-${Date.now()}`;
            const messages = await Promise.all(request.messages.map(msg => this.toOpenAIMessage(msg, request.mediaOptions)));
            const params: any = {
                messages: messages,
                model: request.model,
                temperature: request.temperature,
                max_tokens: request.max_tokens,
                top_p: request.top_p,
                response_format: request.response_format === 'json_object' ? { type: 'json_object' } : undefined,
                stream: true,
            };

            // Build sanitized name mapping for round-trip conversion
            const nameMapping: Map<string, string> = new Map();
            if (request.tools && request.tools.length > 0) {
                params.tools = request.tools.map(t => {
                    const sanitizedName = this.sanitizeToolName(t.function.name);
                    nameMapping.set(sanitizedName, t.function.name);
                    return {
                        type: 'function',
                        function: {
                            name: sanitizedName,
                            description: t.function.description,
                            parameters: t.function.parameters,
                        },
                    };
                });
                params.tool_choice = request.tool_choice || 'auto';
                log(`[OpenAI][${requestId}] Sending ${params.tools.length} tools with tool_choice: ${params.tool_choice}`);
                if (isVerbose()) {
                    log(`[OpenAI][${requestId}] First tool: ${safePreview(params.tools[0], 800)}`);
                }
            } else {
                log(`[OpenAI][${requestId}] NO TOOLS in request`);
            }

            log(`[OpenAI][${requestId}] Stream request: model=${params.model}, messages=${params.messages.length}, tools=${params.tools?.length || 0}, tool_choice=${params.tool_choice ?? 'unset'}`);
            logMessagePreview(requestId, 'OpenAI', params.messages);

            const stream = await this.client.chat.completions.create(
                params,
                request.signal ? { signal: request.signal } : undefined,
            ) as any;

            // Accumulate tool call fragments across chunks
            const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map();

            for await (const chunk of stream) {
                const choice = (chunk as any).choices[0];

                if (choice.finish_reason) {
                    log(`[OpenAI][${requestId}] Stream chunk finish_reason=${choice.finish_reason}`);
                }

                // Accumulate tool call deltas
                if (choice.delta.tool_calls) {
                    for (const tc of choice.delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallAccum.has(idx)) {
                            toolCallAccum.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' });
                        }
                        const acc = toolCallAccum.get(idx)!;
                        if (tc.id) acc.id = tc.id;
                        if (tc.function?.name) acc.name = tc.function.name;
                        if (tc.function?.arguments) acc.args += tc.function.arguments;

                        if (isVerbose()) {
                            log(`[OpenAI][${requestId}] tool_call_delta idx=${idx} id=${tc.id || acc.id || ''} name=${tc.function?.name || acc.name || ''} args_delta=${safePreview(tc.function?.arguments || '', 200)}`);
                        }
                    }
                }

                if (choice.delta.content) {
                    yield {
                        delta: choice.delta.content,
                        finish_reason: choice.finish_reason as any,
                        usage: (chunk as any).usage,
                    };
                }

                if (!choice.delta.content && choice.finish_reason && choice.finish_reason !== 'tool_calls') {
                    yield {
                        delta: '',
                        finish_reason: choice.finish_reason as any,
                        usage: (chunk as any).usage,
                    };
                }

                // When finish_reason is 'tool_calls', emit accumulated tool calls
                if (choice.finish_reason === 'tool_calls' && toolCallAccum.size > 0) {
                    const toolCalls: ToolCallResult[] = Array.from(toolCallAccum.values()).map(acc => ({
                        id: acc.id,
                        name: nameMapping.get(acc.name) || acc.name,
                        arguments: JSON.parse(acc.args || '{}'),
                    }));

                    log(`[OpenAI][${requestId}] Stream finish_reason=tool_calls accumulated_calls=${toolCalls.length} names=${toolCalls.map(tc => tc.name).join(', ')}`);
                    yield {
                        delta: '',
                        finish_reason: 'tool_calls',
                        tool_calls: toolCalls,
                    };
                }
            }
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        try {
            const input = typeof request.input === 'string' ? [request.input] : request.input;
            const response = await this.client.embeddings.create({
                model: request.model,
                input: input,
            });

            return {
                embeddings: response.data.map(d => d.embedding),
                usage: response.usage
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    private async toOpenAIMessage(msg: Message, _options: import('../../types').MediaOptions = {}): Promise<any> {
        // Tool result messages
        if (msg.role === 'tool' && msg.tool_call_id) {
            return {
                role: 'tool',
                tool_call_id: msg.tool_call_id,
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
            };
        }

        // Assistant messages with tool_calls need special handling
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            return {
                role: 'assistant',
                content: typeof msg.content === 'string' ? msg.content : '',
                tool_calls: msg.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: this.sanitizeToolName(tc.function.name),
                        arguments: tc.function.arguments,
                    },
                })),
            };
        }

        // String content
        if (typeof msg.content === 'string') {
            return { role: msg.role, content: msg.content };
        }
        // Null/empty content
        if (msg.content === null || msg.content === undefined) {
            return { role: msg.role, content: '' };
        }
        
        // Import media-utils lazily to avoid circular dependencies if any
        const { normalizeImagePart } = await import('../media-utils.js');
        
        // Multimodal content
        const content = await Promise.all(msg.content.map(async part => {
            if (part.type === 'text') return { type: 'text', text: part.text };
            if (part.type === 'image_url') return { type: 'image_url', image_url: { url: part.image_url.url } };
            
            // For file paths and raw data, normalize to base64 data URI to send inline
            // Note: OpenAI Chat Completions API does not support file_id for images, only URLs and base64.
            // Even if uploadStrategy is 'upload', we cannot use file IDs here. We must inline.
            if (part.type === 'image_data' || part.type === 'image_file') {
                const { data, mimeType } = await normalizeImagePart(part);
                return {
                    type: 'image_url',
                    image_url: { url: `data:${mimeType};base64,${data}` }
                };
            }
            
            return null;
        }));

        return { role: msg.role, content: content.filter(Boolean) };
    }

    private handleError(error: any): Error {
        if (error instanceof OpenAI.APIError) {
            const msg = error.message;
            if (error.status === 401) return new AuthenticationError(msg, error);
            if (error.status === 429) return new RateLimitError(msg, undefined, error); // No retry-after usually in OpenAI lib err?
            if (error.status && error.status >= 400 && error.status < 500) return new InvalidRequestError(msg, error);
            return new ProviderError(msg, error.code || 'OPENAI_ERROR', error.status || 500, error);
        }
        return new ProviderError('Unknown error', 'UNKNOWN', 500, error);
    }
}
