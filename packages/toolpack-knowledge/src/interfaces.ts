export interface Chunk {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
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
  searchType?: 'semantic' | 'keyword' | 'hybrid';
  semanticWeight?: number; // For hybrid search, weight of semantic vs keyword (0-1)
}

export interface MetadataFilter {
  [key: string]: string | number | boolean
    | { $in: unknown[] }
    | { $gt: number }
    | { $lt: number };
}

export interface QueryResult {
  chunk: Chunk;
  score: number;
  distance?: number;
}

export interface KnowledgeProvider {
  add(chunks: Chunk[]): Promise<void>;
  query(queryVector: number[], options?: QueryOptions): Promise<QueryResult[]>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  validateDimensions(dimensions: number): Promise<void>;
  getAllChunks?(): Promise<Chunk[]>;
  close?(): void;
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
