export interface Chunk {
  id: string;
  content: string;
  metadata: Record<string, any>;
  vector?: number[];
}

export interface ChunkUpdate {
  type: 'add' | 'update' | 'delete';
  chunk: Chunk;
}

export interface QueryOptions {
  limit?: number;
  threshold?: number;
  filter?: MetadataFilter;
  includeMetadata?: boolean;
  includeVectors?: boolean;
}

export type MetadataFilterValue =
  | string
  | number
  | boolean
  | { $in: any[] }
  | { $gt: number }
  | { $lt: number }
  | { $gte: number }
  | { $lte: number };

export interface MetadataFilter {
  [key: string]: MetadataFilterValue;
}

export interface QueryResult {
  chunk: Chunk;
  score: number;
  distance?: number;
}

export interface KnowledgeProvider {
  add(chunks: Chunk[]): Promise<void>;
  query(text: string, options?: QueryOptions): Promise<QueryResult[]>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  hasStoredChunks?(): Promise<boolean>;
}

export interface KnowledgeSource {
  load(): AsyncIterable<Chunk>;
  watch?(): AsyncIterable<ChunkUpdate>;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export interface SyncOptions {
  incremental?: boolean;
  sources?: string[];
}

export interface SyncEvent {
  type: 'add' | 'update' | 'delete';
  file?: string;
  chunksAffected: number;
}

export interface EmbeddingProgressEvent {
  phase: 'start' | 'progress' | 'complete';
  totalChunks?: number;
  processedChunks?: number;
  currentSource?: string;
  percentage?: number;
}

export type ErrorAction = 'skip' | 'retry' | 'abort';

export interface ErrorContext {
  file?: string;
  chunkId?: string;
  source?: string;
}

export interface KnowledgeOptions {
  provider: KnowledgeProvider;
  source?: KnowledgeSource;
  sources?: KnowledgeSource[];
  embedder?: Embedder;
  reSync?: boolean;
  onSync?: (event: SyncEvent) => void;
  onEmbeddingProgress?: (event: EmbeddingProgressEvent) => void;
  onError?: (error: Error, context: ErrorContext) => ErrorAction;
}

export interface MarkdownSourceOptions {
  watch?: boolean;
  maxChunkSize?: number;
  chunkOverlap?: number;
  minChunkSize?: number;
  namespace?: string;
  metadata?: Record<string, any>;
}

export interface JSONSourceOptions {
  chunkBy?: 'item' | string;
  contentFields?: string[];
  metadataFields?: string[];
  watch?: boolean;
  namespace?: string;
  metadata?: Record<string, any>;
}

export interface SQLiteTextSourceOptions {
  table: string;
  contentColumns: string[];
  metadataColumns?: string[];
  where?: string;
  watch?: boolean;
  pollInterval?: number;
  namespace?: string;
  metadata?: Record<string, any>;
}

export interface MemoryProviderOptions {
  maxChunks?: number;
}

export interface PersistentKnowledgeProviderOptions {
  storagePath?: string;
  namespace?: string;
}

export interface OllamaEmbedderOptions {
  model?: string;
  baseUrl?: string;
}

export interface OpenAIEmbedderOptions {
  model?: string;
  apiKey?: string;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface GeminiEmbedderOptions {
  model?: string;
  apiKey?: string;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}
