import type { Embedder } from '../types.js';
import { EmbeddingError } from '../errors.js';

const DEFAULT_MODEL = 'text-embedding-004';
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-004': 768,
  'embedding-001': 768,
};

export interface GeminiEmbedderOptions {
  model?: string;
  apiKey?: string;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class GeminiEmbedder implements Embedder {
  private model: string;
  private apiKey: string;
  private retries: number;
  private retryDelay: number;
  private timeout: number;

  constructor(options: GeminiEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.apiKey = options.apiKey ?? process.env.TOOLPACK_GEMINI_KEY ?? process.env.GOOGLE_GENERATIVE_AI_KEY ?? '';
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;

    if (!this.apiKey) {
      throw new Error('Gemini API key is required. Set TOOLPACK_GEMINI_KEY or GOOGLE_GENERATIVE_AI_KEY environment variable, or pass apiKey option.');
    }
  }

  get dimensions(): number {
    return MODEL_DIMENSIONS[this.model] ?? 768;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        // Gemini embedding API endpoint
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: texts.map((text) => ({
              model: `models/${this.model}`,
              content: { parts: [{ text }] },
            })),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
          const errorMessage = errorData.error?.message ?? response.statusText;

          if (response.status === 429) {
            lastError = new EmbeddingError(`Rate limited: ${errorMessage}`);
            await this.sleep(this.retryDelay * Math.pow(2, attempt));
            continue;
          }

          throw new EmbeddingError(`Gemini embedding failed: ${response.status} - ${errorMessage}`);
        }

        const data = (await response.json()) as {
          embeddings: Array<{ values: number[] }>;
        };

        return data.embeddings.map((e) => e.values);
      } catch (error) {
        if (error instanceof EmbeddingError) {
          lastError = error;
        } else if ((error as Error).name === 'AbortError') {
          lastError = new EmbeddingError('Request timed out');
        } else {
          lastError = new EmbeddingError(
            `Failed to get embedding from Gemini: ${(error as Error).message}`,
            error as Error
          );
        }

        if (attempt < this.retries - 1) {
          await this.sleep(this.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    throw lastError ?? new EmbeddingError('Unknown embedding error');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
