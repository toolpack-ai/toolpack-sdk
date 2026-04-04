import { Embedder } from '../interfaces.js';
import { EmbeddingError } from '../errors.js';

export interface OllamaEmbedderOptions {
  model: string;
  baseUrl?: string;
  /** Override auto-detected dimensions for custom/unknown models */
  dimensions?: number;
  retries?: number;
  retryDelay?: number;
}

export class OllamaEmbedder implements Embedder {
  readonly dimensions: number;
  private baseUrl: string;

  constructor(private options: OllamaEmbedderOptions) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.dimensions = options.dimensions || this.getModelDimensions(options.model);
  }

  private getModelDimensions(model: string): number {
    const dimensionsMap: Record<string, number> = {
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024,
      'all-minilm': 384,
      'snowflake-arctic-embed': 1024,
      'bge-m3': 1024,
      'bge-large': 1024,
      'all-minilm:l6-v2': 384,
      'all-minilm:l12-v2': 384,
    };
    const dims = dimensionsMap[model];
    if (!dims) {
      throw new EmbeddingError(
        `Unknown Ollama model '${model}'. Provide 'dimensions' in OllamaEmbedderOptions ` +
        `or use a known model: ${Object.keys(dimensionsMap).join(', ')}`
      );
    }
    return dims;
  }

  async embed(text: string): Promise<number[]> {
    let lastError: Error | null = null;
    const retries = this.options.retries || 3;
    const retryDelay = this.options.retryDelay || 1000;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.options.model, prompt: text }),
        });

        if (!response.ok) {
          throw new EmbeddingError(`Ollama embedding failed: ${response.statusText}`, response.status);
        }

        const data = await response.json() as { embedding: number[] };
        return data.embedding;
      } catch (error) {
        lastError = error as Error;
        if (error instanceof EmbeddingError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          // Don't retry client errors (4xx)
          throw error;
        }
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    throw new EmbeddingError(`Ollama embedding failed after ${retries} retries: ${lastError?.message}`);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }
}
