import type { Embedder, OllamaEmbedderOptions } from '../types.js';
import { EmbeddingError } from '../errors.js';

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaEmbedder implements Embedder {
  private model: string;
  private baseUrl: string;
  private _dimensions: number | null = null;

  constructor(options: OllamaEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  get dimensions(): number {
    if (this._dimensions === null) {
      throw new Error('Dimensions not yet determined. Call embed() first.');
    }
    return this._dimensions;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new EmbeddingError(
          `Ollama embedding failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as { embedding: number[] };
      const embedding = data.embedding;

      if (this._dimensions === null) {
        this._dimensions = embedding.length;
      }

      return embedding;
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      throw new EmbeddingError(
        `Failed to get embedding from Ollama: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
