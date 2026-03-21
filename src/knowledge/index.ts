export { Knowledge } from './knowledge.js';
export type { KnowledgeTool } from './knowledge.js';

export { MemoryProvider } from './providers/memory-provider.js';

export { MarkdownSource } from './sources/markdown-source.js';
export { JSONSource } from './sources/json-source.js';
export { SQLiteTextSource } from './sources/sqlite-text-source.js';

export { OllamaEmbedder } from './embedders/ollama-embedder.js';
export { OpenAIEmbedder } from './embedders/openai-embedder.js';
export { GeminiEmbedder } from './embedders/gemini-embedder.js';

export {
  KnowledgeError,
  EmbeddingError,
  IngestionError,
  ChunkTooLargeError,
  ProviderError as KnowledgeProviderError,
} from './errors.js';

export type {
  Chunk,
  ChunkUpdate,
  QueryOptions,
  QueryResult,
  MetadataFilter,
  MetadataFilterValue,
  KnowledgeProvider,
  KnowledgeSource,
  Embedder,
  SyncOptions,
  SyncEvent,
  EmbeddingProgressEvent,
  ErrorAction,
  ErrorContext,
  KnowledgeOptions,
  MarkdownSourceOptions,
  JSONSourceOptions,
  SQLiteTextSourceOptions,
  MemoryProviderOptions,
  OllamaEmbedderOptions,
  OpenAIEmbedderOptions,
  GeminiEmbedderOptions,
} from './types.js';
