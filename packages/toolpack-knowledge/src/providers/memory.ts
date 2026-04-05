import { KnowledgeProvider, Chunk, QueryOptions, QueryResult } from '../interfaces.js';
import { DimensionMismatchError, KnowledgeProviderError } from '../errors.js';
import { cosineSimilarity, matchesFilter } from '../utils/cosine.js';

export interface MemoryProviderOptions {
  maxChunks?: number;
}

export class MemoryProvider implements KnowledgeProvider {
  private chunks = new Map<string, { chunk: Chunk; vector: number[] }>();
  private dimensions?: number;

  constructor(private options: MemoryProviderOptions = {}) {}

  async validateDimensions(dimensions: number): Promise<void> {
    if (this.dimensions && this.dimensions !== dimensions) {
      throw new DimensionMismatchError(this.dimensions, dimensions);
    }
    this.dimensions = dimensions;
  }

  async add(chunks: Chunk[]): Promise<void> {
    for (const chunk of chunks) {
      if (!chunk.vector) {
        throw new KnowledgeProviderError('Chunk missing vector');
      }
      
      if (this.options.maxChunks && this.chunks.size >= this.options.maxChunks) {
        throw new KnowledgeProviderError(`Max chunks limit reached: ${this.options.maxChunks}`);
      }

      this.chunks.set(chunk.id, { 
        chunk: {
          id: chunk.id,
          content: chunk.content,
          metadata: chunk.metadata,
        },
        vector: chunk.vector 
      });
    }
  }

  async query(queryVector: number[], options: QueryOptions = {}): Promise<QueryResult[]> {
    const {
      limit = 10,
      threshold = 0.7,
      filter,
      includeMetadata = true,
      includeVectors = false,
    } = options;

    const results: QueryResult[] = [];

    for (const { chunk, vector } of this.chunks.values()) {
      if (filter && !matchesFilter(chunk.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(queryVector, vector);
      
      if (score >= threshold) {
        results.push({
          chunk: {
            id: chunk.id,
            content: chunk.content,
            metadata: includeMetadata ? chunk.metadata : {},
            vector: includeVectors ? vector : undefined,
          },
          score,
          distance: 1 - score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.chunks.delete(id);
    }
  }

  async clear(): Promise<void> {
    this.chunks.clear();
    this.dimensions = undefined;
  }

  async getAllChunks(): Promise<Chunk[]> {
    return Array.from(this.chunks.values()).map(({ chunk, vector }) => ({
      ...chunk,
      vector,
    }));
  }
}
