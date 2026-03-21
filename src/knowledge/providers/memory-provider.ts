import type {
  KnowledgeProvider,
  Chunk,
  QueryOptions,
  QueryResult,
  MetadataFilter,
  MetadataFilterValue,
  MemoryProviderOptions,
} from '../types.js';

interface StoredChunk {
  chunk: Chunk;
  vector: number[];
}

export class MemoryProvider implements KnowledgeProvider {
  private store: Map<string, StoredChunk> = new Map();
  private maxChunks?: number;

  constructor(options: MemoryProviderOptions = {}) {
    this.maxChunks = options.maxChunks;
  }

  async add(chunks: Chunk[]): Promise<void> {
    for (const chunk of chunks) {
      if (!chunk.vector) {
        throw new Error(`Chunk ${chunk.id} has no vector. Ensure embedder is configured.`);
      }

      if (this.maxChunks && this.store.size >= this.maxChunks) {
        throw new Error(`Maximum chunk limit (${this.maxChunks}) reached`);
      }

      this.store.set(chunk.id, {
        chunk: { ...chunk },
        vector: chunk.vector,
      });
    }
  }

  async query(_text: string, options: QueryOptions = {}): Promise<QueryResult[]> {
    const {
      limit = 10,
      threshold = 0.3,
      filter,
      includeMetadata = true,
      includeVectors = false,
    } = options;

    // We need the query vector to be passed in via a special mechanism
    // since MemoryProvider doesn't have access to the embedder directly.
    // The Knowledge class will handle embedding the query and passing the vector.
    const queryVector = (options as any)._queryVector as number[] | undefined;
    if (!queryVector) {
      throw new Error('Query vector not provided. Use Knowledge.query() instead of provider.query() directly.');
    }

    const results: QueryResult[] = [];

    for (const [, stored] of this.store) {
      if (filter && !this.matchesFilter(stored.chunk.metadata, filter)) {
        continue;
      }

      const score = this.cosineSimilarity(queryVector, stored.vector);

      if (score >= threshold) {
        const chunk: Chunk = {
          id: stored.chunk.id,
          content: stored.chunk.content,
          metadata: includeMetadata ? { ...stored.chunk.metadata } : {},
        };

        if (includeVectors) {
          chunk.vector = [...stored.vector];
        }

        results.push({ chunk, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.store.delete(id);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  private matchesFilter(metadata: Record<string, any>, filter: MetadataFilter): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      const value = metadata[key];

      if (!this.matchesCondition(value, condition)) {
        return false;
      }
    }
    return true;
  }

  private matchesCondition(value: any, condition: MetadataFilterValue): boolean {
    if (typeof condition === 'object' && condition !== null) {
      if ('$in' in condition) {
        return Array.isArray(condition.$in) && condition.$in.includes(value);
      }
      if ('$gt' in condition) {
        return typeof value === 'number' && value > condition.$gt;
      }
      if ('$lt' in condition) {
        return typeof value === 'number' && value < condition.$lt;
      }
      if ('$gte' in condition) {
        return typeof value === 'number' && value >= (condition as any).$gte;
      }
      if ('$lte' in condition) {
        return typeof value === 'number' && value <= (condition as any).$lte;
      }
    }

    return value === condition;
  }
}
