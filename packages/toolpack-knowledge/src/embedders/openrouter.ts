import OpenAI from 'openai';
import { Embedder } from '../interfaces.js';
import { EmbeddingError } from '../errors.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterEmbedderOptions {
  model: string;
  apiKey: string;
  /** Override output dimensions for models not in the built-in map */
  dimensions?: number;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class OpenRouterEmbedder implements Embedder {
  readonly dimensions: number;
  private client: OpenAI;

  constructor(private options: OpenRouterEmbedderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: OPENROUTER_BASE_URL,
      timeout: options.timeout || 30000,
    });
    this.dimensions = options.dimensions ?? this.getModelDimensions(options.model);
  }

  private getModelDimensions(model: string): number {
    const dimensionsMap: Record<string, number> = {
      'nvidia/llama-nemotron-embed-vl-1b-v2': 4096,
      'nvidia/llama-nemotron-embed-vl-1b-v2:free': 4096,
      'openai/text-embedding-3-small': 1536,
      'openai/text-embedding-3-large': 3072,
      'openai/text-embedding-ada-002': 1536,
    };
    const dims = dimensionsMap[model];
    if (dims === undefined) {
      throw new EmbeddingError(
        `Unknown OpenRouter embedding model '${model}'. Pass 'dimensions' in OpenRouterEmbedderOptions ` +
        `or use a known model: ${Object.keys(dimensionsMap).join(', ')}`
      );
    }
    return dims;
  }

  async embed(text: string): Promise<number[]> {
    let lastError: Error | null = null;
    const retries = this.options.retries ?? 3;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.options.model,
          input: text,
        });
        return response.data[0].embedding;
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay ?? 1000));
        }
      }
    }

    throw new EmbeddingError(`OpenRouter embedding failed after ${retries} retries: ${lastError?.message}`);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;
    const retries = this.options.retries ?? 3;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.options.model,
          input: texts,
        });
        return response.data.map(d => d.embedding);
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay ?? 1000));
        }
      }
    }

    throw new EmbeddingError(`OpenRouter batch embedding failed after ${retries} retries: ${lastError?.message}`);
  }
}
