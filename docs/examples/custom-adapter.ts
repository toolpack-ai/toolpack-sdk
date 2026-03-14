import {
    ProviderAdapter,
    CompletionRequest,
    CompletionResponse,
    CompletionChunk,
    EmbeddingRequest,
    EmbeddingResponse,
    ProviderModelInfo,
} from 'toolpack-sdk';

/**
 * Example Custom Provider Adapter (Grok / xAI)
 * 
 * This demonstrates how to implement a custom provider for the Toolpack SDK.
 * You must implement three methods: generate, stream, and embed.
 * 
 * Usage:
 * ```typescript
 * const sdk = await Toolpack.init({
 *   customProviders: {
 *     'grok': new GrokAdapter({ apiKey: 'xai-...' })
 *   }
 * });
 * 
 * await sdk.generate('Hello', 'grok');
 * ```
 */
export class GrokAdapter implements ProviderAdapter {
    private apiKey: string;
    private baseUrl: string;

    constructor(config: { apiKey: string; baseUrl?: string }) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || 'https://api.x.ai/v1';
    }

    /**
     * Optional: Provide a human-readable name for your adapter.
     */
    getDisplayName(): string {
        return 'Grok (xAI)';
    }

    /**
     * Optional: Return a list of models supported by this provider.
     * This allows the SDK and UI to discover available models automatically.
     */
    async getModels(): Promise<ProviderModelInfo[]> {
        return [
            {
                id: 'grok-3-latest',
                displayName: 'Grok 3 (Latest)',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: false },
                contextWindow: 131072,
            },
            {
                id: 'grok-beta',
                displayName: 'Grok Beta',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: false },
                contextWindow: 131072,
            }
        ];
    }

    /**
     * Generate a completion.
     *
     * Required contract:
     * - Convert `request.messages` to your provider's message format
     * - Convert `request.tools` to your provider's tool/function format (if supported)
     * - Return a `CompletionResponse` with:
     *   - `content`: string | null (null if the response is only tool calls)
     *   - `usage`: { prompt_tokens, completion_tokens, total_tokens }
     *   - `finish_reason`: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error'
     *   - `tool_calls`: Array of { id, name, arguments } (if the model invoked tools)
     *   - `raw`: the original provider response (for debugging)
     */
    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        // Example: call your provider's API
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages.map(m => ({
                    role: m.role,
                    content: m.content,
                })),
                // Map tools if your provider supports function calling
                tools: request.tools?.map(t => ({
                    type: 'function',
                    function: {
                        name: t.function.name,
                        description: t.function.description,
                        parameters: t.function.parameters,
                    },
                })),
                temperature: request.temperature,
                max_tokens: request.max_tokens,
            }),
        });

        const data = await response.json() as any;
        const choice = data.choices[0];

        // Extract tool calls if present
        let toolCalls = undefined;
        if (choice.message.tool_calls) {
            toolCalls = choice.message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments),
            }));
        }

        return {
            content: choice.message.content,
            usage: data.usage ? {
                prompt_tokens: data.usage.prompt_tokens,
                completion_tokens: data.usage.completion_tokens,
                total_tokens: data.usage.total_tokens,
            } : undefined,
            finish_reason: choice.finish_reason === 'tool_calls' ? 'tool_calls' :
                choice.finish_reason === 'length' ? 'length' : 'stop',
            tool_calls: toolCalls,
            raw: data,
        };
    }

    /**
     * Stream a completion.
     *
     * Required contract:
     * - Yield `CompletionChunk` objects:
     *   - `{ delta: "text" }` — for text content chunks
     *   - `{ delta: "", finish_reason: "stop" }` — when stream ends normally
     *   - `{ delta: "", finish_reason: "tool_calls", tool_calls: [...] }` — when tool calls are ready
     *
     * IMPORTANT: Tool calls may arrive as fragments across multiple chunks.
     * Accumulate them and emit a single chunk with all tool calls when complete.
     */
    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        // Example: SSE streaming
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages.map(m => ({ role: m.role, content: m.content })),
                stream: true,
            }),
        });

        // Parse SSE stream (simplified — use a proper SSE parser like 'eventsource-parser' in production)
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data.trim() === '[DONE]') return;

                try {
                    const chunk = JSON.parse(data);
                    const delta = chunk.choices[0]?.delta;

                    if (delta?.content) {
                        yield { delta: delta.content };
                    }

                    if (chunk.choices[0]?.finish_reason === 'stop') {
                        yield { delta: '', finish_reason: 'stop' };
                    }

                    // Handle tool calls — accumulate and emit when finish_reason is 'tool_calls'
                    if (chunk.choices[0]?.finish_reason === 'tool_calls') {
                        // Note: If your provider streams tool call fragments, you must accumulate them here
                        // and emit them fully formed in a single chunk once complete.
                        yield {
                            delta: '',
                            finish_reason: 'tool_calls',
                            tool_calls: [], // Add accumulated tool call objects here
                        };
                    }
                } catch (e) {
                    // Ignore parse errors from partial lines
                }
            }
        }
    }

    /**
     * Generate embeddings.
     *
     * Required contract:
     * - Accept `request.input` as string or string[]
     * - Return `{ embeddings: number[][], usage?: { ... } }`
     *
     * If your provider doesn't support embeddings, throw an error.
     */
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        const input = typeof request.input === 'string' ? [request.input] : request.input;

        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: request.model,
                input: input,
            }),
        });

        const data = await response.json() as any;

        return {
            embeddings: data.data.map((d: any) => d.embedding),
            usage: data.usage,
        };
    }
}
