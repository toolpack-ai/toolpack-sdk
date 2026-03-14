/**
 * Ollama Adapter
 *
 * Implements the ProviderAdapter interface for local LLM inference via Ollama.
 * Communicates with Ollama's HTTP API (default http://localhost:11434).
 * Framework-agnostic — usable from CLI, web servers, Electron, etc.
 */

import { ProviderAdapter } from '../base';
import {
    CompletionRequest,
    CompletionResponse,
    CompletionChunk,
    Message,
    EmbeddingRequest,
    EmbeddingResponse,
    ProviderModelInfo,
    ToolCallResult,
} from '../../types';
import {
    ConnectionError,
    ProviderError,
    InvalidRequestError,
} from '../../errors';
import { log, safePreview, logMessagePreview, isVerbose } from '../provider-logger';
import { ollamaRequest, ollamaStream } from './http';

// ============================================================================
// Types
// ============================================================================

export interface OllamaAdapterConfig {
    /** Ollama model name, e.g. 'llama3', 'phi3:mini', 'mistral' */
    model: string;
    /** Base URL for the Ollama API. Default: http://localhost:11434 */
    baseUrl?: string;
    /** Request timeout in ms. Default: 120000 (2 min) */
    timeout?: number;
    /** Temperature for generation. Default: 0.7 */
    temperature?: number;
    /** Context window size (num_ctx). Default: model's default */
    numCtx?: number;
}

export interface OllamaModelInfo {
    name: string;
    size: number;
    digest: string;
    modified_at: string;
}

// ============================================================================

// ============================================================================
// Adapter
// ============================================================================

export class OllamaAdapter extends ProviderAdapter {
    private config: OllamaAdapterConfig;
    private baseUrl: string;
    private timeout: number;
    public modelName: string;

    constructor(config: OllamaAdapterConfig) {
        super();
        this.config = config;
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
        this.timeout = config.timeout || 120000;
        this.modelName = config.model;
    }

    getDisplayName(): string {
        return 'Ollama';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        try {
            const ollamaModels = await this.listModels();
            return ollamaModels.map(m => ({
                id: m.name,
                displayName: m.name,
                capabilities: {
                    chat: true,
                    streaming: true,
                    toolCalling: true, // Specific models support tools
                    embeddings: true,
                    vision: true,      // Specific models support vision
                },
            }));
        } catch (err) {
            // Return empty list if Ollama is not running instead of crashing
            return [];
        }
    }

    /**
     * Check if Ollama is running and the configured model is available.
     * Returns the list of available models.
     * Throws ConnectionError if Ollama is unreachable.
     * Throws InvalidRequestError if the model is not pulled.
     */
    async connect(): Promise<OllamaModelInfo[]> {
        const models = await this.listModels();

        const modelBase = this.config.model.split(':')[0].toLowerCase();
        const found = models.some(m => {
            const mBase = m.name.split(':')[0].toLowerCase();
            return mBase === modelBase || m.name.toLowerCase() === this.config.model.toLowerCase();
        });

        if (!found) {
            throw new InvalidRequestError(
                `Model "${this.config.model}" is not pulled in Ollama. ` +
                `Run: ollama pull ${this.config.model}\n` +
                `Available models: ${models.map(m => m.name).join(', ') || '(none)'}`
            );
        }

        return models;
    }

    /**
     * List all models currently pulled in Ollama.
     */
    async listModels(): Promise<OllamaModelInfo[]> {
        try {
            const res = await ollamaRequest(this.baseUrl, '/api/tags', 'GET', undefined, 5000);
            if (res.status !== 200) {
                throw new ProviderError(`Ollama returned status ${res.status}`, 'OLLAMA_ERROR', res.status);
            }
            const data = JSON.parse(res.body);
            return (data.models || []) as OllamaModelInfo[];
        } catch (err: any) {
            if (err instanceof ProviderError) throw err;
            throw new ConnectionError(
                `Cannot connect to Ollama at ${this.baseUrl}. Is Ollama running? (ollama serve)`,
                err
            );
        }
    }

    /**
     * Check if Ollama is reachable (lightweight ping).
     */
    async isAvailable(): Promise<boolean> {
        try {
            await ollamaRequest(this.baseUrl, '/api/tags', 'GET', undefined, 3000);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if a specific model is pulled.
     */
    async isModelAvailable(model?: string): Promise<boolean> {
        try {
            const models = await this.listModels();
            const target = (model || this.config.model).toLowerCase();
            const targetBase = target.split(':')[0];
            return models.some(m => {
                const mBase = m.name.split(':')[0].toLowerCase();
                return mBase === targetBase || m.name.toLowerCase() === target;
            });
        } catch {
            return false;
        }
    }

    private sanitizeToolName(name: string): string {
        return name.replace(/\./g, '_');
    }

    private restoreToolName(sanitized: string, originalTools?: any[]): string {
        const original = originalTools?.find(t => this.sanitizeToolName(t.function.name) === sanitized);
        return original?.function.name || sanitized.replace(/_/g, '.');
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        const requestId = (request as any).__toolpack_request_id || `gen-${Date.now()}`;
        const messages = await Promise.all(request.messages.map(m => this.toOllamaMessage(m, request.mediaOptions)));
        const model = request.model || this.config.model;

        const payload: any = {
            model,
            messages,
            stream: false,
            options: {
                temperature: request.temperature ?? this.config.temperature ?? 0.7,
                num_ctx: this.config.numCtx,
            },
        };

        if (request.tools && request.tools.length > 0 && request.tool_choice !== 'none') {
            payload.tools = request.tools.map(t => ({
                type: 'function',
                function: {
                    name: this.sanitizeToolName(t.function.name),
                    description: t.function.description,
                    parameters: t.function.parameters,
                }
            }));
            log(`[Ollama][${requestId}] Sending ${request.tools.length} tools with tool_choice: ${request.tool_choice || 'unset'}`);
            if (isVerbose() && request.tools.length > 0) {
                log(`[Ollama][${requestId}] First tool: ${safePreview(request.tools[0], 800)}`);
            }
        } else {
            log(`[Ollama][${requestId}] NO TOOLS in request`);
        }

        log(`[Ollama][${requestId}] generate() request: model=${model}, messages=${request.messages.length}, tools=${request.tools?.length || 0}`);
        logMessagePreview(requestId, 'Ollama', request.messages);

        try {
            const res = await ollamaRequest(
                this.baseUrl,
                '/api/chat',
                'POST',
                payload,
                this.timeout,
            );

            if (res.status !== 200) {
                throw this.handleHttpError(res.status, res.body);
            }

            const data = JSON.parse(res.body);

            const toolCalls: ToolCallResult[] = [];
            if (data.message?.tool_calls) {
                for (const tc of data.message.tool_calls) {
                    toolCalls.push({
                        id: `ollama_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                        name: this.restoreToolName(tc.function.name, request.tools),
                        arguments: tc.function.arguments || {},
                    });
                }
            }

            const response: CompletionResponse = {
                content: data.message?.content || null,
                usage: data.prompt_eval_count != null ? {
                    prompt_tokens: data.prompt_eval_count || 0,
                    completion_tokens: data.eval_count || 0,
                    total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                } : undefined,
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : (data.done ? 'stop' : undefined),
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                raw: data,
            };

            log(`[Ollama][${requestId}] Response finish_reason=${response.finish_reason} tool_calls=${toolCalls.length} content_preview=${safePreview(response.content, 200)}`);

            return response;
        } catch (err: any) {
            if (err instanceof ProviderError) throw err;
            throw new ConnectionError(
                `Failed to generate with Ollama model "${model}": ${err.message}`,
                err
            );
        }
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        const requestId = (request as any).__toolpack_request_id || `str-${Date.now()}`;
        const messages = await Promise.all(request.messages.map(m => this.toOllamaMessage(m, request.mediaOptions)));
        const model = request.model || this.config.model;

        const payload: any = {
            model,
            messages,
            stream: true,
            options: {
                temperature: request.temperature ?? this.config.temperature ?? 0.7,
                num_ctx: this.config.numCtx,
            },
        };

        if (request.tools && request.tools.length > 0 && request.tool_choice !== 'none') {
            payload.tools = request.tools.map(t => ({
                type: 'function',
                function: {
                    name: this.sanitizeToolName(t.function.name),
                    description: t.function.description,
                    parameters: t.function.parameters,
                }
            }));
            log(`[Ollama][${requestId}] Sending ${request.tools.length} tools with tool_choice: ${request.tool_choice || 'unset'}`);
            if (isVerbose() && request.tools.length > 0) {
                log(`[Ollama][${requestId}] First tool: ${safePreview(request.tools[0], 800)}`);
            }
        } else {
            log(`[Ollama][${requestId}] NO TOOLS in request`);
        }

        log(`[Ollama][${requestId}] Stream request: model=${model}, messages=${request.messages.length}, tools=${request.tools?.length || 0}`);
        logMessagePreview(requestId, 'Ollama', request.messages);

        const { stream } = ollamaStream(
            this.baseUrl,
            '/api/chat',
            payload,
            this.timeout,
            request.signal,
        );

        try {
            for await (const line of stream) {
                try {
                    const data = JSON.parse(line);

                    if (data.message?.content) {
                        // If there are tool calls in this very same chunk and it's done,
                        // we shouldn't mark finish_reason='stop' because tool_calls is the real finish state.
                        const hasTools = data.message.tool_calls && data.message.tool_calls.length > 0;
                        yield {
                            delta: data.message.content,
                            finish_reason: (data.done && !hasTools) ? 'stop' : undefined,
                            usage: data.done && data.prompt_eval_count != null ? {
                                prompt_tokens: data.prompt_eval_count || 0,
                                completion_tokens: data.eval_count || 0,
                                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                            } : undefined,
                        };
                    }

                    if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
                        const toolCalls = data.message.tool_calls.map((tc: any) => ({
                            id: `ollama_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                            name: this.restoreToolName(tc.function.name, request.tools),
                            arguments: tc.function.arguments || {},
                        }));
                        log(`[Ollama][${requestId}] Stream finish_reason=tool_calls name=${toolCalls[0]?.name}`);
                        yield {
                            delta: '',
                            finish_reason: 'tool_calls',
                            tool_calls: toolCalls,
                        };
                    }

                    // If done but no content was yielded above (e.g. only tool calls)
                    if (data.done && !data.message?.content && !data.message?.tool_calls) {
                        log(`[Ollama][${requestId}] Stream chunk finish_reason=stop`);
                        yield { delta: '', finish_reason: 'stop' };
                        return;
                    }
                } catch {
                    // Skip malformed JSON lines
                }
            }
        } catch (err: any) {
            throw new ConnectionError(
                `Stream failed for Ollama model "${model}": ${err.message}`,
                err
            );
        }
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        const requestId = (request as any).__toolpack_request_id || `emb-${Date.now()}`;
        const input = typeof request.input === 'string' ? [request.input] : request.input;
        const model = request.model || this.config.model;

        log(`[Ollama][${requestId}] Embedding request: model=${model}, inputs=${input.length}`);

        try {
            const res = await ollamaRequest(
                this.baseUrl,
                '/api/embed', // using the new batch endpoint
                'POST',
                { model, input },
                this.timeout,
            );

            if (res.status !== 200) {
                throw this.handleHttpError(res.status, res.body);
            }

            const data = JSON.parse(res.body);
            return { embeddings: data.embeddings || [] };
        } catch (err: any) {
            if (err instanceof ProviderError) throw err;
            throw new ConnectionError(
                `Embedding failed for Ollama model "${model}": ${err.message}`,
                err
            );
        }
    }

    /**
     * No persistent connection to close — Ollama is stateless HTTP.
     */
    async disconnect(): Promise<void> {
        // No-op
    }

    private async toOllamaMessage(msg: Message, _options: import('../../types').MediaOptions = {}): Promise<any> {
        let content = '';
        const images: string[] = [];
        
        // Import media-utils lazily
        const { normalizeImagePart } = await import('../media-utils.js');

        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (msg.content !== null) {
            // Flatten multimodal text and extract base64 images
            for (const part of msg.content) {
                if (part.type === 'text') {
                    content += part.text + '\n';
                } else if (part.type === 'image_url' || part.type === 'image_data' || part.type === 'image_file') {
                    try {
                        const { data } = await normalizeImagePart(part);
                        images.push(data);
                    } catch (err) {
                        if (part.type === 'image_url') {
                            content += `[Image: ${part.image_url.url}]\n`;
                        } else {
                            content += `[Unresolvable Image]\n`;
                        }
                    }
                }
            }
            content = content.trim();
        }

        const ollamaMsg: any = { role: msg.role, content };
        if (images.length > 0) {
            ollamaMsg.images = images;
        }

        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            ollamaMsg.tool_calls = msg.tool_calls.map(tc => ({
                function: {
                    name: this.sanitizeToolName(tc.function.name),
                    arguments: typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments || '{}')
                        : tc.function.arguments,
                }
            }));
        } else if (msg.role === 'tool') {
            // Ollama expects 'tool_name' on tool result messages (not 'name')
            ollamaMsg.content = content || JSON.stringify(msg.content);
            if (msg.name) {
                ollamaMsg.tool_name = this.sanitizeToolName(msg.name);
            }
        }

        return ollamaMsg;
    }

    private handleHttpError(status: number, body: string): ProviderError {
        let message = `Ollama error (HTTP ${status})`;
        try {
            const data = JSON.parse(body);
            if (data.error) message = `Ollama: ${data.error}`;
        } catch { /* use default message */ }

        if (status === 404) {
            return new InvalidRequestError(`Model not found: ${message}`);
        }
        return new ProviderError(message, 'OLLAMA_ERROR', status);
    }
}
