import { OpenAIAdapter } from '../openai/index.js';
import { ProviderModelInfo, CompletionRequest, CompletionResponse, CompletionChunk } from '../../types/index.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterOptions {
    siteUrl?: string;
    siteName?: string;
}

export class OpenRouterAdapter extends OpenAIAdapter {
    name = 'openrouter';
    private readonly _apiKey: string;

    constructor(apiKey: string, options: OpenRouterOptions = {}) {
        super(apiKey, OPENROUTER_BASE_URL);
        this._apiKey = apiKey;
        // Attribution headers (HTTP-Referer, X-Title) are best-effort and only matter for
        // the OpenRouter leaderboard — they don't affect routing or pricing.
        // Injecting them requires a protected client in the parent; skip for now.
        void options;
    }

    getDisplayName(): string {
        return 'OpenRouter';
    }

    supportsFileUpload(): boolean {
        return false;
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        return super.generate(this.normalizeRequest(request));
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        yield* super.stream(this.normalizeRequest(request));
    }

    // OpenRouter passes tool_choice straight to the model endpoint with no translation.
    // Models like Nemotron reject tool_choice: 'none' with a 404. Strip tools entirely
    // instead — same effect, universally supported.
    private normalizeRequest(request: CompletionRequest): CompletionRequest {
        if (request.tool_choice === 'none') {
            return { ...request, tools: undefined, tool_choice: undefined };
        }
        return request;
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        try {
            const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
                headers: { Authorization: `Bearer ${this._apiKey}` },
            });
            if (!res.ok) return [];
            const json = await res.json() as { data: any[] };
            return json.data.map(m => this.mapModel(m));
        } catch {
            return [];
        }
    }

    private mapModel(m: any): ProviderModelInfo {
        const modality: string = m.architecture?.modality ?? 'text->text';
        const hasVision = modality.includes('image');
        return {
            id: m.id,
            displayName: m.name ?? m.id,
            capabilities: {
                chat: true,
                streaming: true,
                toolCalling: true,
                embeddings: false,
                vision: hasVision,
            },
            contextWindow: m.context_length ?? undefined,
            maxOutputTokens: m.top_provider?.max_completion_tokens ?? undefined,
            inputModalities: hasVision ? ['text', 'image'] : ['text'],
            outputModalities: ['text'],
            reasoningTier: null,
            costTier: this.deriveCostTier(m.pricing),
        };
    }

    // OpenRouter pricing.prompt is cost per token in USD.
    // Multiply by 1e6 to get cost per 1M tokens for comparison.
    // Thresholds calibrated against real prices (May 2026):
    //   low    <  $1/1M  (Llama 3, Haiku, GPT-4.1 Mini)
    //   medium <  $5/1M  (GPT-4.1, Claude Sonnet)
    //   high   < $20/1M  (GPT-4o, Claude Opus)
    //   premium >= $20/1M (o3, frontier reasoning models)
    private deriveCostTier(pricing?: { prompt?: string }): string {
        if (!pricing?.prompt) return 'unknown';
        const costPerM = parseFloat(pricing.prompt) * 1_000_000;
        if (costPerM < 1) return 'low';
        if (costPerM < 5) return 'medium';
        if (costPerM < 20) return 'high';
        return 'premium';
    }
}
