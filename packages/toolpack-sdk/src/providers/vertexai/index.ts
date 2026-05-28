import { GoogleGenAI } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { ProviderAdapter } from '../base/index.js';
import type {
    CompletionRequest,
    CompletionResponse,
    CompletionChunk,
    ToolCallResult,
    Message,
    EmbeddingRequest,
    EmbeddingResponse,
    ProviderModelInfo,
} from '../../types/index.js';
import { AuthenticationError, RateLimitError, InvalidRequestError, ProviderError } from '../../errors/index.js';
import { logDebug, safePreview, logMessagePreview } from '../provider-logger.js';

export interface VertexAIConfig {
    /** GCP project ID. Falls back to TOOLPACK_VERTEXAI_PROJECT or VERTEX_AI_PROJECT env vars. */
    projectId?: string;

    /** GCP region. Defaults to 'us-central1'. Falls back to TOOLPACK_VERTEXAI_LOCATION or VERTEX_AI_LOCATION env vars. */
    location?: string;

    /**
     * Optional Google Auth options.
     * When omitted, Application Default Credentials (ADC) are used automatically.
     * Set GOOGLE_APPLICATION_CREDENTIALS env var to point to a service account JSON file.
     */
    googleAuthOptions?: {
        /** Path to a service account key JSON file. */
        keyFilename?: string;
        /** Inline service account credentials object. */
        credentials?: Record<string, unknown>;
    };
}

export class VertexAIAdapter extends ProviderAdapter {
    private ai: GoogleGenAI;
    private readonly location: string;

    constructor(config: VertexAIConfig = {}) {
        super();
        this.name = 'vertexai';

        const projectId =
            config.projectId ??
            process.env.TOOLPACK_VERTEXAI_PROJECT ??
            process.env.VERTEX_AI_PROJECT ??
            process.env.GOOGLE_CLOUD_PROJECT;

        if (!projectId) {
            throw new AuthenticationError(
                'Vertex AI requires a GCP project ID. ' +
                'Pass projectId in config or set TOOLPACK_VERTEXAI_PROJECT / VERTEX_AI_PROJECT / GOOGLE_CLOUD_PROJECT.',
            );
        }

        this.location =
            config.location ??
            process.env.TOOLPACK_VERTEXAI_LOCATION ??
            process.env.VERTEX_AI_LOCATION ??
            'us-central1';

        this.ai = new GoogleGenAI({
            vertexai: true,
            project: projectId,
            location: this.location,
            ...(config.googleAuthOptions ? { googleAuthOptions: config.googleAuthOptions as any } : {}),
        } as any);
    }

    getDisplayName(): string {
        return 'Google Vertex AI';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        return [
            {
                id: 'gemini-2.5-pro-preview-05-06',
                displayName: 'Gemini 2.5 Pro Preview',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 1048576,
                maxOutputTokens: 65536,
            },
            {
                id: 'gemini-2.5-flash-preview-04-17',
                displayName: 'Gemini 2.5 Flash Preview',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 1048576,
                maxOutputTokens: 65536,
            },
            {
                id: 'gemini-2.0-flash-001',
                displayName: 'Gemini 2.0 Flash',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 1048576,
                maxOutputTokens: 8192,
            },
            {
                id: 'gemini-1.5-pro-002',
                displayName: 'Gemini 1.5 Pro',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 2097152,
                maxOutputTokens: 8192,
            },
            {
                id: 'gemini-1.5-flash-002',
                displayName: 'Gemini 1.5 Flash',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 1048576,
                maxOutputTokens: 8192,
            },
        ];
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        try {
            const requestId = (request as any).__toolpack_request_id || `vtx-${Date.now()}`;
            logDebug(`[VertexAI][${requestId}] generate() model=${request.model} messages=${request.messages.length} tools=${request.tools?.length ?? 0}`);
            logMessagePreview(requestId, 'VertexAI', request.messages);

            const { model, config } = this.buildRequestParams(request);
            const { history, lastUserMessage } = this.formatHistory(request.messages);

            const contents: Content[] = [
                ...history,
                {
                    role: 'user',
                    parts: typeof lastUserMessage === 'string' ? [{ text: lastUserMessage }] : lastUserMessage,
                },
            ];

            const response = await this.ai.models.generateContent({ model, contents, config });

            const { content, toolCalls } = this.parseResponse(response, request.tools);

            logDebug(`[VertexAI][${requestId}] Response finish_reason=${toolCalls.length > 0 ? 'tool_calls' : 'stop'} tool_calls=${toolCalls.length} content_preview=${safePreview(content, 200)}`);

            return {
                content: content || null,
                usage: {
                    prompt_tokens: response.usageMetadata?.promptTokenCount ?? 0,
                    completion_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
                    total_tokens: response.usageMetadata?.totalTokenCount ?? 0,
                },
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                raw: response,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        try {
            const requestId = (request as any).__toolpack_request_id || `vtx-str-${Date.now()}`;
            logDebug(`[VertexAI][${requestId}] stream() model=${request.model} messages=${request.messages.length} tools=${request.tools?.length ?? 0}`);
            logMessagePreview(requestId, 'VertexAI', request.messages);

            const { model, config } = this.buildRequestParams(request);
            const { history, lastUserMessage } = this.formatHistory(request.messages);

            const contents: Content[] = [
                ...history,
                {
                    role: 'user',
                    parts: typeof lastUserMessage === 'string' ? [{ text: lastUserMessage }] : lastUserMessage,
                },
            ];

            const chunkStream = await this.ai.models.generateContentStream({ model, contents, config });

            for await (const chunk of chunkStream) {
                for (const candidate of chunk.candidates ?? []) {
                    for (const part of candidate.content?.parts ?? []) {
                        if ((part as any).functionCall) {
                            const fc = (part as any).functionCall;
                            logDebug(`[VertexAI][${requestId}] stream tool_call name=${fc.name}`);
                            yield {
                                delta: '',
                                finish_reason: 'tool_calls',
                                tool_calls: [{
                                    id: `vtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                    name: this.restoreToolName(fc.name, request.tools),
                                    arguments: fc.args ?? {},
                                }],
                            };
                        } else if ((part as any).text) {
                            yield { delta: (part as any).text };
                        }
                    }
                }
            }
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
        // Vertex AI embeddings use a separate textembedding-gecko / text-embedding-004 model
        // via the Prediction API, not the generative model API. Out of scope for initial release.
        throw new InvalidRequestError(
            'Vertex AI embeddings are not supported by this adapter. ' +
            'Use the Gemini adapter (gemini provider) with text-embedding-004 instead.',
        );
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    private buildRequestParams(request: CompletionRequest): { model: string; config: any } {
        const config: any = {
            systemInstruction: this.extractSystemInstruction(request.messages),
            maxOutputTokens: request.max_tokens,
            temperature: request.temperature,
            topP: request.top_p,
            // responseMimeType must not be set to 'application/json' when function declarations
            // are present — Vertex AI / Gemini does not support both simultaneously and will
            // truncate the response to a single token. JSON mode is honoured only for tool-free requests.
            responseMimeType: (request.response_format === 'json_object' && !(request.tools?.length))
                ? 'application/json'
                : 'text/plain',
        };

        if (request.tools && request.tools.length > 0) {
            config.tools = [{
                functionDeclarations: request.tools.map(t => ({
                    name: this.sanitizeToolName(t.function.name),
                    description: t.function.description,
                    parameters: this.sanitizeSchema(t.function.parameters),
                })),
            }];
        }

        return { model: request.model, config };
    }

    private formatHistory(messages: Message[]): { history: Content[]; lastUserMessage: Part[] | string } {
        const conversation = messages.filter(m => m.role !== 'system');

        if (conversation.length === 0) {
            return { history: [], lastUserMessage: '' };
        }

        const historyMsgs = conversation.slice(0, -1);
        const lastMsg = conversation[conversation.length - 1];

        const history: Content[] = historyMsgs.map(m => {
            if (m.role === 'tool' && m.tool_call_id) {
                return {
                    role: 'function',
                    parts: [{
                        functionResponse: {
                            name: this.sanitizeToolName(m.name ?? m.tool_call_id),
                            response: {
                                name: this.sanitizeToolName(m.name ?? m.tool_call_id),
                                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                            },
                        },
                    }],
                } as unknown as Content;
            }

            if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                const parts: Part[] = [];
                if (typeof m.content === 'string' && m.content) parts.push({ text: m.content });
                for (const tc of m.tool_calls) {
                    parts.push({
                        functionCall: {
                            name: this.sanitizeToolName(tc.function.name),
                            args: typeof tc.function.arguments === 'string'
                                ? JSON.parse(tc.function.arguments || '{}')
                                : tc.function.arguments,
                        },
                    } as unknown as Part);
                }
                return { role: 'model', parts };
            }

            return {
                role: m.role === 'user' ? 'user' : 'model',
                parts: this.contentToParts(m.content),
            };
        });

        return {
            history,
            lastUserMessage: this.contentToParts(lastMsg.content),
        };
    }

    private contentToParts(content: Message['content']): Part[] {
        if (typeof content === 'string') return [{ text: content }];
        if (!content) return [];
        return content
            .map((p: any) => {
                if (p.type === 'text') return { text: p.text } as Part;
                if (p.type === 'image_data') {
                    return { inlineData: { mimeType: p.mimeType ?? 'image/jpeg', data: p.data } } as unknown as Part;
                }
                return null;
            })
            .filter((p): p is Part => p !== null);
    }

    private parseResponse(response: any, requestTools?: CompletionRequest['tools']): { content: string; toolCalls: ToolCallResult[] } {
        const toolCalls: ToolCallResult[] = [];
        let content = '';

        for (const candidate of response.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
                if ((part as any).text) {
                    content += (part as any).text;
                }
                if ((part as any).functionCall) {
                    const fc = (part as any).functionCall;
                    toolCalls.push({
                        id: `vtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        name: this.restoreToolName(fc.name, requestTools),
                        arguments: fc.args ?? {},
                    });
                }
            }
        }

        return { content, toolCalls };
    }

    private extractSystemInstruction(messages: Message[]): string | undefined {
        const systems = messages.filter(m => m.role === 'system');
        if (systems.length === 0) return undefined;
        return systems
            .map(m => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
    }

    private sanitizeToolName(name: string): string {
        return name.replace(/\./g, '_');
    }

    private restoreToolName(sanitized: string, tools?: CompletionRequest['tools']): string {
        const original = tools?.find(t => this.sanitizeToolName(t.function.name) === sanitized);
        return original?.function.name ?? sanitized.replace(/_/g, '.');
    }

    private sanitizeSchema(schema: any): any {
        if (!schema || typeof schema !== 'object') return schema;
        const sanitized: any = {};
        for (const [key, value] of Object.entries(schema)) {
            if (['additionalProperties', 'exclusiveMinimum', 'exclusiveMaximum', '$schema', '$id', 'definitions', '$defs'].includes(key)) continue;
            sanitized[key] = typeof value === 'object' && value !== null
                ? Array.isArray(value) ? (value as any[]).map(i => this.sanitizeSchema(i)) : this.sanitizeSchema(value)
                : value;
        }
        return sanitized;
    }

    private handleError(error: any): Error {
        const msg: string = error?.message ?? String(error);
        if (error?.status === 429 || msg.includes('RESOURCE_EXHAUSTED')) return new RateLimitError(msg, undefined, error);
        if (error?.status === 401 || error?.status === 403 || msg.includes('UNAUTHENTICATED') || msg.includes('PERMISSION_DENIED')) {
            return new AuthenticationError(msg, error);
        }
        if (error?.status >= 400 && error?.status < 500) return new InvalidRequestError(msg, error);
        return new ProviderError(msg || 'Vertex AI Error', 'VERTEXAI_ERROR', error?.status ?? 500, error);
    }
}
