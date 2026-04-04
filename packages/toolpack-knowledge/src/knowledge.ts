import { KnowledgeProvider, KnowledgeSource, Embedder, QueryOptions, QueryResult, Chunk } from './interfaces.js';

export interface KnowledgeOptions {
  provider: KnowledgeProvider;
  sources: KnowledgeSource[];
  embedder: Embedder;
  description: string;
  reSync?: boolean;
  onError?: ErrorHandler;
  onSync?: SyncEventHandler;
  onEmbeddingProgress?: EmbeddingProgressHandler;
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
    const vector = await this.embedder.embed(text);
    return this.provider.query(vector, options);
  }

  async sync(): Promise<void> {
    this.options.onSync?.({ type: 'start' });

    try {
      const dimensions = this.embedder.dimensions;
      await this.provider.clear();
      await this.provider.validateDimensions(dimensions);

      const allChunks: Chunk[] = [];
      
      for (const source of this.sources) {
        for await (const chunk of source.load()) {
          allChunks.push(chunk);
        }
      }

      const embeddedChunks = await this.embedChunks(allChunks);

      if (embeddedChunks.length > 0) {
        await this.provider.add(embeddedChunks);
      }

      this.options.onSync?.({ type: 'complete', chunksAffected: embeddedChunks.length });
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
          threshold: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.7)' },
          filter: { type: 'object', description: 'Optional metadata filters' },
        },
        required: ['query'],
      },
      execute: async (params: KnowledgeToolParams) => {
        const results = await this.query(params.query, {
          limit: params.limit,
          threshold: params.threshold,
          filter: params.filter,
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
