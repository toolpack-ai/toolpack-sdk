import { Embedder } from '../interfaces.js';
import { EmbeddingError } from '../errors.js';

export interface OllamaEmbedderOptions {
  model: string;
  baseUrl?: string;
}

export class OllamaEmbedder implements Embedder {
  readonly dimensions: number;
  private baseUrl: string;

  constructor(private options: OllamaEmbedderOptions) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.dimensions = this.getModelDimensions(options.model);
  }

  private getModelDimensions(model: string): number {
    const dimensionsMap: Record<string, number> = {
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024,
      'all-minilm': 384,
    };
    return dimensionsMap[model] || 768;
  }

  async embed(text: string): Promise<number[]> {
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
      if (error instanceof EmbeddingError) {
        throw error;
      }
      throw new EmbeddingError(`Ollama embedding failed: ${(error as Error).message}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }
}
