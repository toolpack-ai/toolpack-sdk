import OpenAI from 'openai';
import { Embedder } from '../interfaces.js';
import { EmbeddingError } from '../errors.js';

export interface OpenAIEmbedderOptions {
  model: string;
  apiKey: string;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class OpenAIEmbedder implements Embedder {
  readonly dimensions: number;
  private client: OpenAI;

  constructor(private options: OpenAIEmbedderOptions) {
    this.client = new OpenAI({ 
      apiKey: options.apiKey,
      timeout: options.timeout || 30000,
    });
    this.dimensions = this.getModelDimensions(options.model);
  }

  private getModelDimensions(model: string): number {
    const dimensionsMap: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };
    return dimensionsMap[model] || 1536;
  }

  async embed(text: string): Promise<number[]> {
    let lastError: Error | null = null;
    const retries = this.options.retries || 3;
    
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
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay || 1000));
        }
      }
    }
    
    throw new EmbeddingError(`OpenAI embedding failed after ${retries} retries: ${lastError?.message}`);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;
    const retries = this.options.retries || 3;
    
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
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay || 1000));
        }
      }
    }
    
    throw new EmbeddingError(`OpenAI batch embedding failed after ${retries} retries: ${lastError?.message}`);
  }
}
