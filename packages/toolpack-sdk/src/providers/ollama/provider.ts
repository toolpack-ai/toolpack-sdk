import { ProviderAdapter } from "../base/index.js";
import {
    CompletionRequest,
    CompletionResponse,
    CompletionChunk,
    EmbeddingRequest,
    EmbeddingResponse,
    ProviderModelInfo,
} from "../../types/index.js";
import { OllamaAdapter, OllamaModelInfo } from "./adapter.js";
import { ollamaRequest } from "./http.js";

export class OllamaProvider extends ProviderAdapter {
    private baseUrl: string;
    private timeout: number;
    private adapterCache: Map<string, OllamaAdapter> = new Map();
    private capabilityCache: Map<string, { toolCalling: boolean; vision: boolean; embeddings: boolean }> = new Map();

    constructor(config?: { baseUrl?: string }) {
        super();
        this.baseUrl = config?.baseUrl || 'http://localhost:11434';
        this.timeout = 120000; // Default 2 min (not configurable via ProviderOptions)
    }

    getDisplayName(): string {
        return 'Ollama';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        // Fetch all pulled models from /api/tags
        let models: OllamaModelInfo[];
        try {
            const res = await ollamaRequest(this.baseUrl, '/api/tags', 'GET', undefined, 5000);
            if (res.status !== 200) return [];
            const data = JSON.parse(res.body);
            models = (data.models || []) as OllamaModelInfo[];
        } catch {
            // Ollama not running — return empty, don't crash
            return [];
        }

        // For each model, try /api/show to detect capabilities
        return Promise.all(models.map(m => this.buildModelInfo(m)));
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        return this.getAdapterForModel(request.model).generate(this.stripToolsIfNeeded(request));
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        yield* this.getAdapterForModel(request.model).stream(this.stripToolsIfNeeded(request));
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        return this.getAdapterForModel(request.model).embed(request);
    }

    async disconnect(): Promise<void> {
        this.adapterCache.clear();
        this.capabilityCache.clear();
    }

    /**
     * Strip tools from a request if the model doesn't support tool calling.
     * Also appends a system-level instruction so the model doesn't hallucinate tool usage.
     */
    private stripToolsIfNeeded(request: CompletionRequest): CompletionRequest {
        const caps = this.capabilityCache.get(request.model);
        if (caps && !caps.toolCalling && request.tools && request.tools.length > 0) {
            const { tools, tool_choice, ...rest } = request as any;
            const stripped = rest as CompletionRequest;

            // Append instruction to prevent the model from hallucinating tool calls
            const noToolsNotice = {
                role: 'system' as const,
                content: 'You do not have access to any tools or functions. Do not attempt to call tools, output tool invocations, or reference tool usage. Answer the user directly using only your own knowledge.',
            };
            stripped.messages = [...stripped.messages, noToolsNotice];

            return stripped;
        }
        return request;
    }

    // ---- Private ----

    private getAdapterForModel(model: string): OllamaAdapter {
        let adapter = this.adapterCache.get(model);
        if (!adapter) {
            adapter = new OllamaAdapter({
                model,
                baseUrl: this.baseUrl,
                timeout: this.timeout,
            });
            this.adapterCache.set(model, adapter);
        }
        return adapter;
    }

    /**
     * Build ProviderModelInfo for a model.
     *
     * Primary detection: query /api/show for vision/embedding hints,
     * then probe /api/chat with a dummy tool to check tool support.
     * Fallback: heuristic matching on model name for vision/embeddings.
     */
    private async buildModelInfo(m: OllamaModelInfo): Promise<ProviderModelInfo> {
        let toolCalling = false;
        let vision = false;
        let embeddings = false;

        try {
            const res = await ollamaRequest(
                this.baseUrl, '/api/show', 'POST',
                { model: m.name }, 3000
            );
            if (res.status === 200) {
                const info = JSON.parse(res.body);
                const families: string[] = (info.details?.families || []).map((f: string) => f.toLowerCase());

                // Vision: model family includes 'clip' or similar vision encoder
                vision = families.some((f: string) => ['clip', 'mllama'].includes(f));
                // Embeddings: model family is embedding-specific
                embeddings = families.some((f: string) => f.includes('bert') || f.includes('nomic'));
            }
        } catch {
            // /api/show failed — fall back to heuristics
        }

        // Probe Ollama to check if the model actually accepts tools
        toolCalling = await this.probeToolSupport(m.name);

        // Heuristic fallback for vision/embeddings
        const nameLower = m.name.toLowerCase();
        if (!vision) {
            const visionModels = ['llava', 'vision', 'bakllava', 'moondream'];
            vision = visionModels.some(v => nameLower.includes(v));
        }
        if (!embeddings) {
            const embeddingModels = ['nomic-embed', 'mxbai-embed', 'all-minilm', 'bge-', 'snowflake-arctic-embed'];
            embeddings = embeddingModels.some(e => nameLower.includes(e));
        }

        const caps = { toolCalling, vision, embeddings };
        this.capabilityCache.set(m.name, caps);

        return {
            id: m.name,
            displayName: m.name,
            capabilities: {
                chat: true,
                streaming: true,
                toolCalling,
                embeddings,
                vision,
            },
        };
    }

    /**
     * Probe whether a model supports tools by sending a minimal /api/chat
     * request with a dummy tool and stream:false. If Ollama returns an error
     * like "does not support tools", the model doesn't support them.
     */
    private async probeToolSupport(model: string): Promise<boolean> {
        try {
            const res = await ollamaRequest(
                this.baseUrl, '/api/chat', 'POST',
                {
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    tools: [{
                        type: 'function',
                        function: {
                            name: '__probe',
                            description: 'probe',
                            parameters: { type: 'object', properties: {} },
                        },
                    }],
                    stream: false,
                },
                10000,
            );
            // If Ollama returned an error body, tools aren't supported
            if (res.status >= 400) return false;
            const data = JSON.parse(res.body);
            return !data.error;
        } catch {
            return false;
        }
    }
}
