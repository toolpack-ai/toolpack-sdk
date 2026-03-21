import type { Embedder, OpenAIEmbedderOptions } from '../types.js';
import { EmbeddingError } from '../errors.js';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

export class OpenAIEmbedder implements Embedder {
  private model: string;
  private apiKey: string;
  private retries: number;
  private retryDelay: number;
  private timeout: number;

  constructor(options: OpenAIEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.apiKey = options.apiKey ?? process.env.TOOLPACK_OPENAI_KEY ?? process.env.OPENAI_API_KEY ?? '';
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;

    if (!this.apiKey) {
      throw new Error('OpenAI API key is required. Set TOOLPACK_OPENAI_KEY or OPENAI_API_KEY environment variable, or pass apiKey option.');
    }
  }

  get dimensions(): number {
    return MODEL_DIMENSIONS[this.model] ?? 1536;
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

        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
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
          
          throw new EmbeddingError(`OpenAI embedding failed: ${response.status} - ${errorMessage}`);
        }

        const data = (await response.json()) as {
          data: Array<{ embedding: number[]; index: number }>;
        };

        const embeddings = data.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);

        return embeddings;
      } catch (error) {
        if (error instanceof EmbeddingError) {
          lastError = error;
        } else if ((error as Error).name === 'AbortError') {
          lastError = new EmbeddingError('Request timed out');
        } else {
          lastError = new EmbeddingError(
            `Failed to get embedding from OpenAI: ${(error as Error).message}`,
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
