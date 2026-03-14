import Anthropic from '@anthropic-ai/sdk';
import { ProviderAdapter } from '../base';
import { CompletionRequest, CompletionResponse, CompletionChunk, ToolCallResult, Message, EmbeddingRequest, EmbeddingResponse, ProviderModelInfo, FileUploadRequest, FileUploadResponse } from '../../types';
import { AuthenticationError, RateLimitError, InvalidRequestError, ProviderError } from '../../errors';
import { log, safePreview, logMessagePreview, isVerbose } from '../provider-logger';

export class AnthropicAdapter extends ProviderAdapter {
    private client: Anthropic;

    constructor(apiKey: string, baseURL?: string) {
        super();
        this.client = new Anthropic({
            apiKey,
            baseURL,
        });
    }

    /**
     * @experimental Anthropic Files API is in beta.
     */
    supportsFileUpload(): boolean {
        return true;
    }

    /**
     * Upload a file to Anthropic's Files API (beta).
     * @experimental This API is in beta and may change.
     */
    async uploadFile(request: FileUploadRequest): Promise<FileUploadResponse> {
        try {
            const fs = await import('fs');
            if (!request.filePath) {
                throw new InvalidRequestError('Anthropic uploadFile requires a filePath.');
            }
            // Anthropic Files API (beta) - uses multipart upload
            const response = await (this.client as any).files.create({
                file: fs.createReadStream(request.filePath),
                purpose: request.purpose || 'vision',
            });
            return {
                id: response.id,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    /**
     * Delete an uploaded file from Anthropic's Files API (beta).
     * @experimental This API is in beta and may change.
     */
    async deleteFile(fileId: string): Promise<void> {
        try {
            await (this.client as any).files.delete(fileId);
        } catch (error) {
            throw this.handleError(error);
        }
    }

    getDisplayName(): string {
        return 'Anthropic';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        return [
            {
                id: 'claude-haiku-4-5-20251001',
                displayName: 'Claude Haiku 4.5',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 200000,
                maxOutputTokens: 64000,
            },
            {
                id: 'claude-sonnet-4-5-20250929',
                displayName: 'Claude Sonnet 4.5',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 200000,
                maxOutputTokens: 16384,
            },
            {
                id: 'claude-sonnet-4-6',
                displayName: 'Claude Sonnet 4.6',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 200000,
                maxOutputTokens: 16384,
            },
            {
                id: 'claude-opus-4-5',
                displayName: 'Claude Opus 4.5',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 200000,
                maxOutputTokens: 16384,
            },
            {
                id: 'claude-opus-4-6',
                displayName: 'Claude Opus 4.6',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 200000,
                maxOutputTokens: 16384,
            },
        ];
    }

    /**
     * Sanitize tool name for Anthropic API (must match ^[a-zA-Z0-9_-]{1,128}$)
     * Converts dots to underscores: fs.read_file -> fs_read_file
     */
    private sanitizeToolName(name: string): string {
        return name.replace(/\./g, '_');
    }

    /**
     * Restore original tool name from sanitized version
     */
    private restoreToolName(sanitized: string, originalTools?: any[]): string {
        const original = originalTools?.find(t => this.sanitizeToolName(t.function.name) === sanitized);
        return original?.function.name || sanitized.replace(/_/g, '.');
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        try {
            const requestId = (request as any).__toolpack_request_id || `gen-${Date.now()}`;
            const messages = await this.toAnthropicMessages(request.messages, request.mediaOptions);
            const system = messages.system;
            const userMessages = messages.userMessages;

            const params: any = {
                model: request.model,
                messages: userMessages,
                system: system,
                max_tokens: request.max_tokens || 4096,
                temperature: request.temperature,
                top_p: request.top_p,
                stream: false,
            };

            if (request.tools && request.tools.length > 0) {
                params.tools = request.tools.map(t => ({
                    name: this.sanitizeToolName(t.function.name),
                    description: t.function.description,
                    input_schema: t.function.parameters,
                }));
                if (request.tool_choice === 'required') {
                    params.tool_choice = { type: 'any' };
                } else if (request.tool_choice === 'none') {
                    // Anthropic doesn't have a direct 'none' — omit tools instead
                    delete params.tools;
                } else {
                    params.tool_choice = { type: 'auto' };
                }

                log(`[Anthropic][${requestId}] Sending ${params.tools?.length || 0} tools with tool_choice: ${params.tool_choice?.type || 'unset'}`);
                if (isVerbose() && params.tools && params.tools.length > 0) {
                    log(`[Anthropic][${requestId}] First tool: ${safePreview(params.tools[0], 800)}`);
                }
            } else {
                log(`[Anthropic][${requestId}] NO TOOLS in request`);
            }

            log(`[Anthropic][${requestId}] generate() request: model=${params.model}, messages=${params.messages.length}, tools=${params.tools?.length || 0}, tool_choice=${params.tool_choice?.type ?? 'unset'}`);
            logMessagePreview(requestId, 'Anthropic', params.messages);

            const response = await this.client.messages.create(
                params,
                request.signal ? { signal: request.signal } : undefined,
            );

            const textParts: string[] = [];
            const toolCalls: ToolCallResult[] = [];

            for (const block of response.content) {
                if (block.type === 'text') {
                    textParts.push(block.text);
                } else if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id,
                        name: this.restoreToolName(block.name, request.tools),
                        arguments: block.input as Record<string, any>,
                    });
                }
            }

            log(`[Anthropic][${requestId}] Response finish_reason=${response.stop_reason} tool_calls=${toolCalls.length} content_preview=${safePreview(textParts.join(''), 200)}`);

            return {
                content: textParts.length > 0 ? textParts.join('') : null,
                usage: {
                    prompt_tokens: response.usage.input_tokens,
                    completion_tokens: response.usage.output_tokens,
                    total_tokens: response.usage.input_tokens + response.usage.output_tokens,
                },
                finish_reason: this.mapFinishReason(response.stop_reason),
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                raw: response,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        try {
            const requestId = (request as any).__toolpack_request_id || `str-${Date.now()}`;
            const messages = await this.toAnthropicMessages(request.messages, request.mediaOptions);

            const params: any = {
                model: request.model,
                messages: messages.userMessages,
                system: messages.system,
                max_tokens: request.max_tokens || 4096,
                temperature: request.temperature,
                top_p: request.top_p,
                stream: true,
            };

            if (request.tools && request.tools.length > 0) {
                params.tools = request.tools.map(t => ({
                    name: this.sanitizeToolName(t.function.name),
                    description: t.function.description,
                    input_schema: t.function.parameters,
                }));
                if (request.tool_choice === 'required') {
                    params.tool_choice = { type: 'any' };
                } else if (request.tool_choice === 'none') {
                    delete params.tools;
                } else {
                    params.tool_choice = { type: 'auto' };
                }

                log(`[Anthropic][${requestId}] Sending ${params.tools?.length || 0} tools with tool_choice: ${params.tool_choice?.type || 'unset'}`);
                if (isVerbose() && params.tools && params.tools.length > 0) {
                    log(`[Anthropic][${requestId}] First tool: ${safePreview(params.tools[0], 800)}`);
                }
            } else {
                log(`[Anthropic][${requestId}] NO TOOLS in request`);
            }

            log(`[Anthropic][${requestId}] Stream request: model=${params.model}, messages=${params.messages.length}, tools=${params.tools?.length || 0}, tool_choice=${params.tool_choice?.type ?? 'unset'}`);
            logMessagePreview(requestId, 'Anthropic', params.messages);

            const stream = await this.client.messages.create(
                params,
                request.signal ? { signal: request.signal } : undefined,
            );

            // Track tool_use blocks being streamed
            let currentToolId = '';
            let currentToolName = '';
            let currentToolArgs = '';
            let inToolUse = false;

            for await (const chunk of stream as any) {
                if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
                    inToolUse = true;
                    currentToolId = chunk.content_block.id;
                    currentToolName = chunk.content_block.name;
                    currentToolArgs = '';
                }

                if (chunk.type === 'content_block_delta') {
                    if (chunk.delta.type === 'text_delta') {
                        yield { delta: chunk.delta.text };
                    } else if (chunk.delta.type === 'input_json_delta' && inToolUse) {
                        currentToolArgs += chunk.delta.partial_json;
                    }
                }

                if (chunk.type === 'content_block_stop' && inToolUse) {
                    log(`[Anthropic][${requestId}] Stream finish_reason=tool_calls accumulated_call=${currentToolName}`);
                    yield {
                        delta: '',
                        finish_reason: 'tool_calls',
                        tool_calls: [{
                            id: currentToolId,
                            name: this.restoreToolName(currentToolName, request.tools),
                            arguments: JSON.parse(currentToolArgs || '{}'),
                        }],
                    };
                    inToolUse = false;
                }

                if (chunk.type === 'message_stop') {
                    log(`[Anthropic][${requestId}] Stream chunk finish_reason=stop`);
                    yield { delta: '', finish_reason: 'stop' };
                }
            }
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
        throw new InvalidRequestError('Embeddings are not strictly supported by the Anthropic API currently.');
    }

    private async toAnthropicMessages(messages: Message[], _options: import('../../types').MediaOptions = {}): Promise<{ system?: string; userMessages: any[] }> {
        let system: string | undefined = undefined;
        const userMessages: any[] = [];
        
        // Import media-utils lazily
        const { normalizeImagePart } = await import('../media-utils.js');

        for (const msg of messages) {
            if (msg.role === 'system') {
                if (typeof msg.content === 'string') {
                    system = msg.content;
                } else if (msg.content !== null) {
                    const txt = msg.content.filter(p => typeof p === 'object' && p.type === 'text').map(p => (p as any).text).join('\n');
                    if (txt) system = txt;
                }
            } else if (msg.role === 'tool' && msg.tool_call_id) {
                // Tool result — Anthropic expects this as a user message with tool_result content
                userMessages.push({
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: msg.tool_call_id,
                        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                    }],
                });
            } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                const content: any[] = [];
                if (typeof msg.content === 'string' && msg.content) {
                    content.push({ type: 'text', text: msg.content });
                } else if (Array.isArray(msg.content)) {
                    // Extract text parts if needed
                    const text = msg.content.filter(p => typeof p === 'object' && p.type === 'text').map(p => (p as any).text).join('\n');
                    if (text) content.push({ type: 'text', text });
                }
                for (const tc of msg.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: this.sanitizeToolName(tc.function.name),
                        input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments,
                    });
                }
                userMessages.push({
                    role: 'assistant',
                    content: content,
                });
            } else {
                let content: any[] = [];
                if (typeof msg.content === 'string') {
                    content = msg.content as any;
                } else if (msg.content !== null) {
                    content = (await Promise.all(msg.content.map(async part => {
                        if (part.type === 'text') return { type: 'text', text: part.text };
                        
                        if (part.type === 'image_url') {
                            const url = part.image_url.url;
                            if (url.startsWith('data:')) {
                                const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
                                if (match) {
                                    return {
                                        type: 'image',
                                        source: { type: 'base64', media_type: match[1], data: match[2] },
                                    };
                                }
                            }
                            return { type: 'image', source: { type: 'url', url } };
                        }
                        
                        if (part.type === 'image_data' || part.type === 'image_file') {
                            const { data, mimeType } = await normalizeImagePart(part);
                            return {
                                type: 'image',
                                source: { type: 'base64', media_type: mimeType, data: data }
                            };
                        }
                        
                        return null;
                    }))).filter(Boolean) as any;
                }

                userMessages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: content,
                });
            }
        }
        return { system, userMessages };
    }

    private mapFinishReason(reason: string | null): any {
        if (reason === 'end_turn') return 'stop';
        if (reason === 'max_tokens') return 'length';
        if (reason === 'stop_sequence') return 'stop';
        return reason;
    }

    private handleError(error: any): Error {
        if (error instanceof Anthropic.APIError) {
            const msg = error.message;
            if (error.status === 401) return new AuthenticationError(msg, error);
            if (error.status === 429) return new RateLimitError(msg, undefined, error);
            if (error.status && error.status >= 400 && error.status < 500) return new InvalidRequestError(msg, error);
            return new ProviderError(msg, 'ANTHROPIC_ERROR', error.status || 500, error);
        }
        return new ProviderError('Unknown Anthropic error', 'UNKNOWN', 500, error);
    }
}
