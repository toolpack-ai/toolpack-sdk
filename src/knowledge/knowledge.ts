import type {
  KnowledgeOptions,
  KnowledgeProvider,
  KnowledgeSource,
  Embedder,
  Chunk,
  ChunkUpdate,
  QueryOptions,
  QueryResult,
  SyncOptions,
  SyncEvent,
  EmbeddingProgressEvent,
  ErrorAction,
  ErrorContext,
} from './types.js';
import { KnowledgeError, EmbeddingError } from './errors.js';
import { OllamaEmbedder } from './embedders/ollama-embedder.js';
import { OpenAIEmbedder } from './embedders/openai-embedder.js';

export class Knowledge {
  private provider: KnowledgeProvider;
  private sources: KnowledgeSource[];
  private embedder: Embedder;
  private onSync?: (event: SyncEvent) => void;
  private onEmbeddingProgress?: (event: EmbeddingProgressEvent) => void;
  private onError?: (error: Error, context: ErrorContext) => ErrorAction;
  private watchAbortControllers: AbortController[] = [];
  private isWatching = false;

  private constructor(
    provider: KnowledgeProvider,
    sources: KnowledgeSource[],
    embedder: Embedder,
    onSync?: (event: SyncEvent) => void,
    onEmbeddingProgress?: (event: EmbeddingProgressEvent) => void,
    onError?: (error: Error, context: ErrorContext) => ErrorAction
  ) {
    this.provider = provider;
    this.sources = sources;
    this.embedder = embedder;
    this.onSync = onSync;
    this.onEmbeddingProgress = onEmbeddingProgress;
    this.onError = onError;
  }

  static async create(options: KnowledgeOptions): Promise<Knowledge> {
    const sources = options.sources ?? (options.source ? [options.source] : []);

    if (sources.length === 0) {
      throw new KnowledgeError('At least one source is required');
    }

    const embedder = options.embedder ?? (await Knowledge.detectEmbedder());

    const knowledge = new Knowledge(
      options.provider,
      sources,
      embedder,
      options.onSync,
      options.onEmbeddingProgress,
      options.onError
    );

    const shouldResync = options.reSync ?? true;
    if (shouldResync) {
      await knowledge.sync();
    } else {
      const providerHasChunks =
        typeof options.provider.hasStoredChunks === 'function'
          ? await options.provider.hasStoredChunks()
          : false;

      if (!providerHasChunks) {
        await knowledge.sync();
      }
    }

    return knowledge;
  }

  private static async detectEmbedder(): Promise<Embedder> {
    const ollama = new OllamaEmbedder();
    if (await ollama.isAvailable()) {
      return ollama;
    }

    if (process.env.TOOLPACK_OPENAI_KEY || process.env.OPENAI_API_KEY) {
      return new OpenAIEmbedder();
    }

    throw new KnowledgeError(
      'No embedder available. Either start Ollama or set TOOLPACK_OPENAI_KEY/OPENAI_API_KEY environment variable.'
    );
  }

  async sync(options: SyncOptions = {}): Promise<void> {
    const { incremental = false, sources: sourceFilter } = options;

    if (!incremental) {
      await this.provider.clear();
    }

    const relevantSources = this.sources.filter((source) => {
      const namespace = (source as any).options?.namespace;
      return !sourceFilter || !namespace || sourceFilter.includes(namespace);
    });

    if (relevantSources.length === 0) {
      this.emitEmbeddingProgress({
        phase: 'complete',
        processedChunks: 0,
        totalChunks: 0,
        percentage: 100,
      });
      return;
    }

    const totalChunks = await this.countChunks(relevantSources);

    this.emitEmbeddingProgress({ phase: 'start', totalChunks });

    let totalProcessed = 0;
    let nextMilestone = 10;

    for (const source of relevantSources) {
      const sourceNamespace = (source as any).options?.namespace || 'default';
      let chunksProcessed = 0;

      try {
        for await (const chunk of source.load()) {
          let retries = 0;
          const maxRetries = 3;
          
          while (true) {
            try {
              const embeddedChunk = await this.embedChunk(chunk);
              await this.provider.add([embeddedChunk]);
              chunksProcessed++;
              totalProcessed++;

              if (totalChunks > 0) {
                const percentage = Math.floor((totalProcessed / totalChunks) * 100);
                while (percentage >= nextMilestone && nextMilestone < 100) {
                  this.emitEmbeddingProgress({
                    phase: 'progress',
                    processedChunks: totalProcessed,
                    totalChunks,
                    currentSource: sourceNamespace,
                    percentage: nextMilestone,
                  });
                  nextMilestone += 10;
                }
              }
              break;
            } catch (error) {
              const action = this.handleError(error as Error, {
                file: chunk.metadata.source,
                chunkId: chunk.id,
                source: sourceNamespace,
              });

              if (action === 'abort') {
                throw error;
              } else if (action === 'retry' && retries < maxRetries) {
                retries++;
                await this.sleep(1000 * retries);
                continue;
              }
              break;
            }
          }
        }

        this.emitSyncEvent('add', chunksProcessed, sourceNamespace);
      } catch (error) {
        if (error instanceof KnowledgeError) throw error;
        throw new KnowledgeError(`Sync failed: ${(error as Error).message}`);
      }
    }

    // Emit complete event
    this.emitEmbeddingProgress({
      phase: 'complete',
      processedChunks: totalProcessed,
      totalChunks,
      percentage: 100,
    });

    if (this.sources.some((s) => (s as any).options?.watch)) {
      this.startWatching();
    }
  }

  private async countChunks(sources: KnowledgeSource[]): Promise<number> {
    let count = 0;
    for (const source of sources) {
      for await (const _chunk of source.load()) {
        count++;
      }
    }
    return count;
  }

  async query(text: string, options: QueryOptions = {}): Promise<QueryResult[]> {
    try {
      const queryVector = await this.embedder.embed(text);
      
      const internalOptions = {
        ...options,
        _queryVector: queryVector,
      };

      return await this.provider.query(text, internalOptions);
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      throw new KnowledgeError(`Query failed: ${(error as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    this.isWatching = false;
    
    for (const controller of this.watchAbortControllers) {
      controller.abort();
    }
    this.watchAbortControllers = [];

    for (const source of this.sources) {
      if (typeof (source as any).stop === 'function') {
        (source as any).stop();
      }
    }
  }

  toTool(): KnowledgeTool {
    return {
      name: 'knowledge_search',
      description: 'Search the internal knowledge base for relevant information from your local documentation, guides, and stored content. Use this for finding information in your own knowledge base, NOT for searching the web.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant knowledge',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
          filter: {
            type: 'object',
            description: 'Optional metadata filters',
          },
        },
        required: ['query'],
      },
      execute: async (args: { query: string; limit?: number; filter?: Record<string, any> }) => {
        const results = await this.query(args.query, {
          limit: args.limit ?? 5,
          filter: args.filter,
        });

        return results.map((r) => ({
          content: r.chunk.content,
          score: r.score,
          metadata: r.chunk.metadata,
        }));
      },
    };
  }

  private async embedChunk(chunk: Chunk): Promise<Chunk> {
    try {
      const vector = await this.embedder.embed(chunk.content);
      return { ...chunk, vector };
    } catch (error) {
      throw new EmbeddingError(
        `Failed to embed chunk ${chunk.id}: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  private startWatching(): void {
    if (this.isWatching) return;
    this.isWatching = true;

    for (const source of this.sources) {
      if (typeof source.watch !== 'function') continue;

      const controller = new AbortController();
      this.watchAbortControllers.push(controller);

      this.watchSource(source, controller.signal);
    }
  }

  private async watchSource(source: KnowledgeSource, signal: AbortSignal): Promise<void> {
    if (!source.watch) return;

    try {
      for await (const update of source.watch()) {
        if (signal.aborted) break;

        await this.processUpdate(update);
      }
    } catch (error) {
      if (!signal.aborted) {
        this.handleError(error as Error, { source: (source as any).options?.namespace });
      }
    }
  }

  private async processUpdate(update: ChunkUpdate): Promise<void> {
    try {
      switch (update.type) {
        case 'add':
        case 'update': {
          const embeddedChunk = await this.embedChunk(update.chunk);
          
          if (update.type === 'update') {
            await this.provider.delete([update.chunk.id]);
          }
          
          await this.provider.add([embeddedChunk]);
          this.emitSyncEvent(update.type, 1, update.chunk.metadata.source);
          break;
        }
        case 'delete': {
          await this.provider.delete([update.chunk.id]);
          this.emitSyncEvent('delete', 1, update.chunk.metadata.source);
          break;
        }
      }
    } catch (error) {
      this.handleError(error as Error, {
        chunkId: update.chunk.id,
        file: update.chunk.metadata.source,
      });
    }
  }

  private handleError(error: Error, context: ErrorContext): ErrorAction {
    if (this.onError) {
      return this.onError(error, context);
    }
    return 'skip';
  }

  private emitSyncEvent(type: 'add' | 'update' | 'delete', chunksAffected: number, file?: string): void {
    if (this.onSync) {
      this.onSync({ type, chunksAffected, file });
    }
  }

  private emitEmbeddingProgress(event: EmbeddingProgressEvent): void {
    if (this.onEmbeddingProgress) {
      this.onEmbeddingProgress(event);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export interface KnowledgeTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  execute: (args: any) => Promise<any>;
}
