import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  KnowledgeProvider,
  Chunk,
  QueryOptions,
  QueryResult,
  MetadataFilter,
  MetadataFilterValue,
} from '../types.js';
import { getGlobalToolpackDir } from '../../utils/home-config.js';

export interface PersistentKnowledgeProviderOptions {
  storagePath?: string;
  namespace?: string;
}

interface StoredChunk {
  chunk: Chunk;
  vector: number[];
}

export class PersistentKnowledgeProvider implements KnowledgeProvider {
  private storagePath: string;
  private cache: Map<string, StoredChunk> = new Map();
  private initialized = false;

  constructor(options: PersistentKnowledgeProviderOptions = {}) {
    const namespace = options.namespace || 'default';
    this.storagePath = options.storagePath || path.join(getGlobalToolpackDir(), 'knowledge', namespace);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.storagePath, { recursive: true });
    await this.loadFromDisk();
    this.initialized = true;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const files = await fs.readdir(this.storagePath);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filePath = path.join(this.storagePath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const stored: StoredChunk = JSON.parse(content);
        
        this.cache.set(stored.chunk.id, stored);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async saveChunk(stored: StoredChunk): Promise<void> {
    const fileName = `${this.sanitizeId(stored.chunk.id)}.json`;
    const filePath = path.join(this.storagePath, fileName);
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), 'utf-8');
  }

  private async deleteChunkFile(id: string): Promise<void> {
    const fileName = `${this.sanitizeId(id)}.json`;
    const filePath = path.join(this.storagePath, fileName);
    
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  async add(chunks: Chunk[]): Promise<void> {
    await this.ensureInitialized();

    for (const chunk of chunks) {
      if (!chunk.vector) {
        throw new Error(`Chunk ${chunk.id} has no vector. Ensure embedder is configured.`);
      }

      const stored: StoredChunk = {
        chunk: { ...chunk },
        vector: chunk.vector,
      };

      this.cache.set(chunk.id, stored);
      await this.saveChunk(stored);
    }
  }

  async query(_text: string, options: QueryOptions = {}): Promise<QueryResult[]> {
    await this.ensureInitialized();

    const {
      limit = 10,
      threshold = 0.3,
      filter,
      includeMetadata = true,
      includeVectors = false,
    } = options;

    const queryVector = (options as any)._queryVector as number[] | undefined;
    if (!queryVector) {
      throw new Error('Query vector not provided. Use Knowledge.query() instead of provider.query() directly.');
    }

    const results: QueryResult[] = [];

    for (const [, stored] of this.cache) {
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
    await this.ensureInitialized();

    for (const id of ids) {
      this.cache.delete(id);
      await this.deleteChunkFile(id);
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();

    this.cache.clear();

    try {
      const files = await fs.readdir(this.storagePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(this.storagePath, file));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }

  async hasStoredChunks(): Promise<boolean> {
    await this.ensureInitialized();
    return this.cache.size > 0;
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
