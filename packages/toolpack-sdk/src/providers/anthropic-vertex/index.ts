import AnthropicVertex from '@anthropic-ai/vertex-sdk';
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

export interface AnthropicVertexConfig {
    /** GCP project ID. Falls back to ANTHROPIC_VERTEX_PROJECT_ID / GOOGLE_CLOUD_PROJECT env vars. */
    projectId?: string;
    /** GCP region where Claude models are deployed. Defaults to 'us-east5'. */
    region?: string;
}

export class AnthropicVertexAdapter extends ProviderAdapter {
    private client: AnthropicVertex;

    constructor(config: AnthropicVertexConfig = {}) {
        super();
        this.name = 'anthropic-vertex';

        const projectId =
            config.projectId ??
            process.env.ANTHROPIC_VERTEX_PROJECT_ID ??
            process.env.GOOGLE_CLOUD_PROJECT;

        const region =
            config.region ??
            process.env.ANTHROPIC_VERTEX_REGION ??
            'us-east5';

        this.client = new AnthropicVertex({ projectId, region });
    }

    getDisplayName(): string {
        return 'Anthropic (Vertex AI)';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        return [
            {
                id: 'claude-sonnet-4-5@20250929',
                displayName: 'Claude Sonnet 4.5 (Vertex AI)',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 200000,
                maxOutputTokens: 16384,
            },
            {
                id: 'claude-haiku-4-5@20251001',
                displayName: 'Claude Haiku 4.5 (Vertex AI)',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 200000,
                maxOutputTokens: 16384,
            },
            {
                id: 'claude-3-5-sonnet-v2@20241022',
                displayName: 'Claude 3.5 Sonnet v2 (Vertex AI)',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 200000,
                maxOutputTokens: 8192,
            },
            {
                id: 'claude-3-5-haiku@20241022',
                displayName: 'Claude 3.5 Haiku (Vertex AI)',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true },
                contextWindow: 200000,
                maxOutputTokens: 8192,
            },
        ];
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        try {
            const requestId = (request as any).__toolpack_request_id || `anv-${Date.now()}`;
            const { system, userMessages } = await this.toAnthropicMessages(request.messages);

            const params: any = {
                model: request.model,
                messages: userMessages,
                system,
                max_tokens: request.max_tokens || 4096,
                temperature: request.temperature,
                top_p: request.top_p,
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
            }

            logDebug(`[AnthropicVertex][${requestId}] generate() model=${params.model} messages=${params.messages.length} tools=${params.tools?.length ?? 0}`);
            logMessagePreview(requestId, 'AnthropicVertex', params.messages);

            const response = await this.client.messages.create(params) as any;

            const textParts: string[] = [];
            const toolCalls: ToolCallResult[] = [];

            for (const block of response.content) {
                if (block.type === 'text') textParts.push(block.text);
                if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id,
                        name: this.restoreToolName(block.name, request.tools),
                        arguments: block.input as Record<string, any>,
                    });
                }
            }

            logDebug(`[AnthropicVertex][${requestId}] Response finish_reason=${response.stop_reason} tool_calls=${toolCalls.length} content_preview=${safePreview(textParts.join(''), 200)}`);

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
            const requestId = (request as any).__toolpack_request_id || `anv-str-${Date.now()}`;
            const { system, userMessages } = await this.toAnthropicMessages(request.messages);

            const params: any = {
                model: request.model,
                messages: userMessages,
                system,
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
            }

            logDebug(`[AnthropicVertex][${requestId}] stream() model=${params.model} messages=${params.messages.length} tools=${params.tools?.length ?? 0}`);

            const streamResponse = await this.client.messages.create(params);

            let currentToolId = '';
            let currentToolName = '';
            let currentToolArgs = '';
            let inToolUse = false;

            for await (const chunk of streamResponse as any) {
                if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
                    inToolUse = true;
                    currentToolId = chunk.content_block.id;
                    currentToolName = chunk.content_block.name;
                    currentToolArgs = '';
                }
                if (chunk.type === 'content_block_delta') {
                    if (chunk.delta.type === 'text_delta') yield { delta: chunk.delta.text };
                    else if (chunk.delta.type === 'input_json_delta' && inToolUse) currentToolArgs += chunk.delta.partial_json;
                }
                if (chunk.type === 'content_block_stop' && inToolUse) {
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
                if (chunk.type === 'message_stop') yield { delta: '', finish_reason: 'stop' };
            }
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
        throw new InvalidRequestError('Embeddings are not supported by the Anthropic API.');
    }

    private sanitizeToolName(name: string): string {
        return name.replace(/\./g, '_');
    }

    private restoreToolName(sanitized: string, tools?: CompletionRequest['tools']): string {
        const original = tools?.find(t => this.sanitizeToolName(t.function.name) === sanitized);
        return original?.function.name ?? sanitized.replace(/_/g, '.');
    }

    private async toAnthropicMessages(messages: Message[]): Promise<{ system?: string; userMessages: any[] }> {
        let system: string | undefined;
        const userMessages: any[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                system = typeof msg.content === 'string' ? msg.content : '';
            } else if (msg.role === 'tool' && msg.tool_call_id) {
                const rawContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                const dataMatch = rawContent.match(/^data:([\w/+.-]+);base64,(.+)$/s);
                const toolResultContent: any = dataMatch
                    ? dataMatch[1].startsWith('image/')
                        ? [{ type: 'image', source: { type: 'base64', media_type: dataMatch[1], data: dataMatch[2] } }]
                        : [{ type: 'document', source: { type: 'base64', media_type: dataMatch[1], data: dataMatch[2] } }]
                    : rawContent;
                userMessages.push({
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: msg.tool_call_id,
                        content: toolResultContent,
                    }],
                });
            } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                const content: any[] = [];
                if (typeof msg.content === 'string' && msg.content) content.push({ type: 'text', text: msg.content });
                for (const tc of msg.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: this.sanitizeToolName(tc.function.name),
                        input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments,
                    });
                }
                userMessages.push({ role: 'assistant', content });
            } else {
                let content: any;
                if (typeof msg.content === 'string' || msg.content === null) {
                    content = msg.content ?? '';
                } else {
                    content = (await Promise.all(msg.content.map(async (part: any) => {
                        if (part.type === 'text') return { type: 'text', text: part.text };
                        if (part.type === 'image_url') {
                            const url: string = part.image_url.url;
                            if (url.startsWith('data:')) {
                                const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
                                if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
                            }
                            return { type: 'image', source: { type: 'url', url } };
                        }
                        if (part.type === 'image_data' || part.type === 'image_file') {
                            const { normalizeImagePart } = await import('../media-utils.js');
                            const { data, mimeType } = await normalizeImagePart(part);
                            return { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
                        }
                        if (part.type === 'file') {
                            const { url, mimeType } = part.file;
                            const dataMatch = url.match(/^data:([\w/+.-]+);base64,(.+)$/s);
                            if (dataMatch) {
                                const [, media_type, data] = dataMatch;
                                if (media_type.startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type, data } };
                                return { type: 'document', source: { type: 'base64', media_type, data } };
                            }
                            if (mimeType.startsWith('image/')) return { type: 'image', source: { type: 'url', url } };
                            return { type: 'document', source: { type: 'url', url } };
                        }
                        return null;
                    }))).filter(Boolean);
                }
                userMessages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content });
            }
        }

        return { system, userMessages };
    }

    private mapFinishReason(reason: string | null): CompletionResponse['finish_reason'] {
        if (reason === 'end_turn') return 'stop';
        if (reason === 'max_tokens') return 'length';
        return 'stop';
    }

    private handleError(error: any): Error {
        const msg: string = error?.message ?? String(error);
        if (error?.status === 401 || error?.status === 403) return new AuthenticationError(msg, error);
        if (error?.status === 429) return new RateLimitError(msg, undefined, error);
        if (error?.status >= 400 && error?.status < 500) return new InvalidRequestError(msg, error);
        return new ProviderError(msg || 'Anthropic Vertex error', 'ANTHROPIC_VERTEX_ERROR', error?.status ?? 500, error);
    }
}
