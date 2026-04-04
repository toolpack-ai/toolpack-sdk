# toolpack-knowledge

RAG (Retrieval-Augmented Generation) package for Toolpack SDK.

## Installation

```bash
npm install @toolpack-sdk/knowledge
```

## Quick Start

### Development (Zero Infrastructure)

```typescript
import { Knowledge, MemoryProvider, MarkdownSource, OllamaEmbedder } from '@toolpack-sdk/knowledge';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  sources: [new MarkdownSource('./docs/**/*.md')],
  embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
  description: 'SDK documentation — setup guides, API reference, and examples.',
});

const results = await kb.query('how to install');
console.log(results[0].chunk.content);
```

### Production (Persistent)

```typescript
import { Knowledge, PersistentKnowledgeProvider, MarkdownSource, OpenAIEmbedder } from '@toolpack-sdk/knowledge';

const kb = await Knowledge.create({
  provider: new PersistentKnowledgeProvider({
    namespace: 'cli',
    reSync: false,  // Load from disk if already indexed
  }),
  sources: [new MarkdownSource('./docs/**/*.md')],
  embedder: new OpenAIEmbedder({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY!,
  }),
  description: 'CLI documentation and guides.',
  onEmbeddingProgress: (event) => {
    console.log(`Embedding: ${event.percent}% (${event.current}/${event.total})`);
  },
});

const results = await kb.query('authentication setup', {
  limit: 5,
  threshold: 0.8,
  filter: { hasCode: true },
});
```

### Agent Integration

```typescript
import { Toolpack } from 'toolpack-sdk';
import { Knowledge, MemoryProvider, MarkdownSource, OllamaEmbedder } from '@toolpack-sdk/knowledge';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  sources: [new MarkdownSource('./docs/**/*.md')],
  embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
  description: 'Search this when the user asks about setup, configuration, or API usage.',
});

const toolpack = await Toolpack.init({
  provider: 'anthropic',
  knowledge: kb,  // Registered as knowledge_search tool
});

const response = await toolpack.chat('How do I configure authentication?');
```

## Providers

### MemoryProvider

In-memory vector storage. Zero configuration, perfect for development and prototyping.

```typescript
new MemoryProvider({
  maxChunks: 10000,  // Optional limit
})
```

### PersistentKnowledgeProvider

SQLite-backed persistence for CLI tools and desktop apps.

```typescript
new PersistentKnowledgeProvider({
  namespace: 'my-app',           // Creates ~/.toolpack/knowledge/my-app.db
  storagePath: './custom/path',  // Optional: override storage location
  reSync: false,                 // Optional: skip re-indexing if DB exists
})
```

## Sources

### MarkdownSource

Chunks markdown files by heading hierarchy.

```typescript
new MarkdownSource('./docs/**/*.md', {
  maxChunkSize: 2000,      // Max tokens per chunk
  chunkOverlap: 200,       // Overlap between chunks
  minChunkSize: 100,       // Merge small sections
  namespace: 'docs',       // Prefix for chunk IDs
  metadata: { type: 'documentation' },  // Added to all chunks
})
```

**Features:**
- Heading-based chunking (preserves document structure)
- Frontmatter extraction (YAML)
- Code block detection (`hasCode` metadata)
- Deterministic chunk IDs

## Embedders

### OllamaEmbedder

Local embeddings via Ollama. Zero API cost.

```typescript
new OllamaEmbedder({
  model: 'nomic-embed-text',           // or 'mxbai-embed-large'
  baseUrl: 'http://localhost:11434',   // default
})
```

### OpenAIEmbedder

OpenAI text-embedding models with retry logic.

```typescript
new OpenAIEmbedder({
  model: 'text-embedding-3-small',    // or 'text-embedding-3-large'
  apiKey: process.env.OPENAI_API_KEY,
  retries: 3,                         // default
  retryDelay: 1000,                   // ms, default
  timeout: 30000,                     // ms, default
})
```

## API Reference

### Knowledge.create()

```typescript
interface KnowledgeOptions {
  provider: KnowledgeProvider;
  sources: KnowledgeSource[];
  embedder: Embedder;
  description: string;                        // Required: used as tool description
  reSync?: boolean;                           // default: true
  onError?: (error, context) => 'skip' | 'abort';
  onSync?: (event: SyncEvent) => void;
  onEmbeddingProgress?: (event: EmbeddingProgressEvent) => void;
}
```

### query()

```typescript
await kb.query('search query', {
  limit: 10,              // Max results
  threshold: 0.7,         // Similarity threshold (0-1)
  filter: {               // Metadata filters
    hasCode: true,
    category: { $in: ['api', 'guide'] },
  },
  includeMetadata: true,  // default
  includeVectors: false,  // default
});
```

### Metadata Filters

```typescript
{
  field: 'value',                    // Exact match
  field: { $in: ['a', 'b'] },       // In array
  field: { $gt: 100 },              // Greater than
  field: { $lt: 100 },              // Less than
}
```

## Error Handling

```typescript
const kb = await Knowledge.create({
  // ...
  onError: (error, context) => {
    console.error(`Failed: ${context.file} — ${error.message}`);
    
    if (error instanceof EmbeddingError) {
      return 'skip';  // Skip this chunk, continue
    }
    return 'abort';   // Stop ingestion
  },
});
```

**Error Types:**
- `KnowledgeError` — Base class
- `EmbeddingError` — Embedding API failure
- `IngestionError` — Source file parsing failure
- `ChunkTooLargeError` — Chunk exceeds max size
- `DimensionMismatchError` — Embedder dimensions mismatch
- `KnowledgeProviderError` — Provider operation failure

## License

Apache-2.0
