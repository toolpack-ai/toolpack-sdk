import { randomUUID } from 'crypto';
import { KnowledgeProvider, KnowledgeSource, Embedder, QueryOptions, QueryResult, Chunk } from './interfaces.js';
import { keywordSearch, combineScores } from './utils/keyword.js';
import { matchesFilter } from './utils/cosine.js';
import { IngestionError } from './errors.js';

export interface KnowledgeOptions {
  provider: KnowledgeProvider;
  sources: KnowledgeSource[];
  embedder: Embedder;
  description: string;
  reSync?: boolean;
  onError?: ErrorHandler;
  onSync?: SyncEventHandler;
  onEmbeddingProgress?: EmbeddingProgressHandler;
  streamingBatchSize?: number;
}

export type ErrorHandler = (
  error: Error,
  context: { file?: string; chunk?: Chunk }
) => 'skip' | 'abort';

export interface SyncEvent {
  type: 'start' | 'file' | 'chunk' | 'complete' | 'error';
  file?: string;
  chunksAffected?: number;
  error?: Error;
}

export type SyncEventHandler = (event: SyncEvent) => void;

export interface EmbeddingProgressEvent {
  source: string;
  current: number;
  total: number;
  percent: number;
}

export type EmbeddingProgressHandler = (event: EmbeddingProgressEvent) => void;

export class Knowledge {
  private constructor(
    private provider: KnowledgeProvider,
    private embedder: Embedder,
    private description: string,
    private sources: KnowledgeSource[],
    private options: KnowledgeOptions
  ) {}

  static async create(options: KnowledgeOptions): Promise<Knowledge> {
    await options.provider.validateDimensions(options.embedder.dimensions);

    const kb = new Knowledge(
      options.provider,
      options.embedder,
      options.description,
      options.sources,
      options
    );

    const userWantsSync = options.reSync !== false;

    if (!userWantsSync && 'shouldReSync' in options.provider) {
      if ((options.provider as any).shouldReSync()) {
        await kb.sync();
      }
      return kb;
    }

    if (userWantsSync) {
      await kb.sync();
    }

    return kb;
  }

  async query(text: string, options?: QueryOptions): Promise<QueryResult[]> {
    const searchType = options?.searchType ?? 'semantic';
    const semanticWeight = options?.semanticWeight ?? 0.7;

    if (searchType === 'keyword') {
      return this.keywordQuery(text, options);
    } else if (searchType === 'hybrid') {
      const [semanticResults, keywordResults] = await Promise.all([
        this.semanticQuery(text, options),
        this.keywordQuery(text, options)
      ]);

      return this.combineHybridResults(semanticResults, keywordResults, semanticWeight, options);
    } else {
      return this.semanticQuery(text, options);
    }
  }

  private async semanticQuery(text: string, options?: QueryOptions): Promise<QueryResult[]> {
    const vector = await this.embedder.embed(text);
    return this.provider.query(vector, options);
  }

  private async keywordQuery(text: string, options?: QueryOptions): Promise<QueryResult[]> {
    const {
      limit = 10,
      threshold = 0.1,
      filter,
      includeMetadata = true,
      includeVectors = false,
    } = options || {};

    // Use provider's keywordQuery if available for better performance
    if (typeof this.provider.keywordQuery === 'function') {
      return this.provider.keywordQuery(text, options);
    }

    // Fallback: get all chunks and score them in memory
    const allChunks = await this.getAllChunks();

    const results: QueryResult[] = [];

    for (const chunk of allChunks) {
      if (filter && !matchesFilter(chunk.metadata, filter)) {
        continue;
      }

      const score = keywordSearch(chunk.content, text);

      if (score >= threshold) {
        results.push({
          chunk: {
            id: chunk.id,
            content: chunk.content,
            metadata: includeMetadata ? chunk.metadata : {},
            vector: includeVectors ? chunk.vector : undefined,
          },
          score,
          distance: 1 - score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private combineHybridResults(
    semanticResults: QueryResult[],
    keywordResults: QueryResult[],
    semanticWeight: number,
    options?: QueryOptions
  ): QueryResult[] {
    const {
      limit = 10,
      threshold = 0.5,
      includeMetadata = true,
      includeVectors = false,
    } = options || {};

    // Create a map of chunk IDs to results for efficient lookup
    const semanticMap = new Map(semanticResults.map(r => [r.chunk.id, r]));
    const keywordMap = new Map(keywordResults.map(r => [r.chunk.id, r]));

    const combinedResults: QueryResult[] = [];

    // Combine results from both searches
    const allIds = new Set([...semanticMap.keys(), ...keywordMap.keys()]);

    for (const id of allIds) {
      const semanticResult = semanticMap.get(id);
      const keywordResult = keywordMap.get(id);

      if (!semanticResult && !keywordResult) continue;

      const semanticScore = semanticResult?.score ?? 0;
      const keywordScore = keywordResult?.score ?? 0;
      const combinedScore = combineScores(semanticScore, keywordScore, semanticWeight);

      if (combinedScore >= threshold) {
        combinedResults.push({
          chunk: {
            id: id,
            content: semanticResult?.chunk.content ?? keywordResult!.chunk.content,
            metadata: includeMetadata ? (semanticResult?.chunk.metadata ?? keywordResult!.chunk.metadata) : {},
            vector: includeVectors ? (semanticResult?.chunk.vector ?? keywordResult!.chunk.vector) : undefined,
          },
          score: combinedScore,
          distance: 1 - combinedScore,
        });
      }
    }

    combinedResults.sort((a, b) => b.score - a.score);
    return combinedResults.slice(0, limit);
  }

  private async getAllChunks(): Promise<Chunk[]> {
    if (typeof this.provider.getAllChunks === 'function') {
      return this.provider.getAllChunks();
    }

    // Fallback: query with a dummy vector to get all chunks
    // This won't work with all providers, but works with our current ones
    const dummyVector = new Array(this.embedder.dimensions).fill(0);
    return (await this.provider.query(dummyVector, { limit: 10000, threshold: 0 }))
      .map(r => r.chunk);
  }

  async sync(): Promise<void> {
    this.options.onSync?.({ type: 'start' });

    try {
      const dimensions = this.embedder.dimensions;
      await this.provider.clear();
      await this.provider.validateDimensions(dimensions);

      const batchSize = this.options.streamingBatchSize ?? 100;
      let totalChunks = 0;
      const chunkBuffer: Chunk[] = [];

      for (const source of this.sources) {
        for await (const chunk of source.load()) {
          chunkBuffer.push(chunk);

          if (chunkBuffer.length >= batchSize) {
            const embeddedBatch = await this.embedChunks(chunkBuffer);
            if (embeddedBatch.length > 0) {
              await this.provider.add(embeddedBatch);
              totalChunks += embeddedBatch.length;
            }
            chunkBuffer.length = 0; // Clear buffer
          }
        }
      }

      // Process remaining chunks
      if (chunkBuffer.length > 0) {
        const embeddedBatch = await this.embedChunks(chunkBuffer);
        if (embeddedBatch.length > 0) {
          await this.provider.add(embeddedBatch);
          totalChunks += embeddedBatch.length;
        }
      }

      this.options.onSync?.({ type: 'complete', chunksAffected: totalChunks });
    } catch (error) {
      this.options.onSync?.({ type: 'error', error: error as Error });
      throw error;
    }
  }

  private async embedChunks(chunks: Chunk[]): Promise<Chunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const embeddedChunks: Chunk[] = [];
    
    try {
      const texts = chunks.map(c => c.content);
      const embeddings = await this.embedder.embedBatch(texts);
      
      for (let i = 0; i < chunks.length; i++) {
        embeddedChunks.push({ ...chunks[i], vector: embeddings[i] });
        
        this.options.onEmbeddingProgress?.({
          source: 'sync',
          current: i + 1,
          total: chunks.length,
          percent: Math.round(((i + 1) / chunks.length) * 100),
        });
      }
    } catch (error) {
      const action = this.options.onError?.(error as Error, {});
      if (action === 'abort') {
        throw error;
      }
      
      // Fallback to individual embedding on batch failure
      for (let i = 0; i < chunks.length; i++) {
        try {
          const vector = await this.embedder.embed(chunks[i].content);
          embeddedChunks.push({ ...chunks[i], vector });
          
          this.options.onEmbeddingProgress?.({
            source: 'sync',
            current: i + 1,
            total: chunks.length,
            percent: Math.round(((i + 1) / chunks.length) * 100),
          });
        } catch (embedError) {
          const skipAction = this.options.onError?.(embedError as Error, { chunk: chunks[i] });
          if (skipAction === 'abort') {
            throw embedError;
          }
          // Skip this chunk if action is 'skip'
        }
      }
    }
    
    return embeddedChunks;
  }

  /**
   * Add a single content item to the knowledge base without triggering a full re-sync.
   * This is useful for runtime additions like conversation history or agent state.
   * @param content The text content to add
   * @param metadata Optional metadata to attach to the chunk
   * @returns The ID of the added chunk
   */
  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    try {
      const id = randomUUID();

      // Embed the content
      const vector = await this.embedder.embed(content);

      // Create the chunk
      const chunk: Chunk = {
        id,
        content,
        metadata: metadata || {},
        vector,
      };

      // Add to provider
      await this.provider.add([chunk]);

      return id;
    } catch (error) {
      throw new IngestionError(
        `Failed to add content to knowledge base: ${(error as Error).message}`,
        'add'
      );
    }
  }

  async stop(): Promise<void> {
    if (this.provider.close) {
      this.provider.close();
    }
  }

  toTool(): KnowledgeTool {
    return {
      name: 'knowledge_search',
      displayName: 'Knowledge Search',
      description: this.description || 'Search the knowledge base for relevant information',
      category: 'search',
      cacheable: false,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to find relevant information' },
          limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
          threshold: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.3)' },
          filter: { type: 'object', description: 'Optional metadata filters' },
        },
        required: ['query'],
      },
      execute: async (params: KnowledgeToolParams) => {
        const results = await this.query(params.query, {
          limit: params.limit,
          threshold: params.threshold ?? 0.3,
          filter: params.filter,
          searchType: 'hybrid',
        });
        return results.map(r => ({
          content: r.chunk.content,
          score: r.score,
          metadata: r.chunk.metadata,
        }));
      },
    };
  }
}

export interface KnowledgeTool {
  name: string;
  displayName: string;
  description: string;
  category: string;
  cacheable?: boolean;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
  execute: (params: KnowledgeToolParams) => Promise<KnowledgeToolResult[]>;
}

export interface KnowledgeToolParams {
  query: string;
  limit?: number;
  threshold?: number;
  filter?: Record<string, string | number | boolean | { $in: unknown[] } | { $gt: number } | { $lt: number }>;
}

export interface KnowledgeToolResult {
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}
