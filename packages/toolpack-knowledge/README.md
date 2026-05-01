# toolpack-knowledge

RAG (Retrieval-Augmented Generation) package for Toolpack SDK with advanced features for web crawling, API indexing, streaming ingestion, and hybrid search.

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

### Advanced Usage

```typescript
import { Knowledge, WebUrlSource, ApiDataSource, PersistentKnowledgeProvider, OllamaEmbedder } from '@toolpack-sdk/knowledge';

// Web crawling + API indexing with hybrid search
const kb = await Knowledge.create({
  provider: new PersistentKnowledgeProvider({ namespace: 'advanced-docs' }),
  sources: [
    new WebUrlSource(['https://docs.example.com'], {
      maxDepth: 2,
      delayMs: 1000,
    }),
    new ApiDataSource('https://api.example.com/docs', {
      pagination: { param: 'page', start: 1, maxPages: 5 },
      contentExtractor: (doc) => `${doc.title}\n\n${doc.content}`,
    }),
  ],
  embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
  streamingBatchSize: 50,  // Efficient processing of large datasets
  description: 'Comprehensive documentation from web and API sources.',
});

// Hybrid search combining semantic and keyword matching
const results = await kb.query('authentication setup', {
  searchType: 'hybrid',
  semanticWeight: 0.6,  // 60% semantic, 40% keyword
  limit: 10,
  threshold: 0.7,
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

## Advanced Features

### Web URL Sources

Crawl and index websites with automatic HTML parsing and link following.

```typescript
import { WebUrlSource } from '@toolpack-sdk/knowledge';

const webSource = new WebUrlSource(['https://docs.example.com'], {
  maxDepth: 3,                    // Follow links up to 3 levels deep
  delayMs: 1000,                  // Respectful crawling delay
  userAgent: 'MyApp/1.0',         // Custom user agent
  maxChunkSize: 1500,             // Chunk size for web content
  timeoutMs: 30000,               // Request timeout
  sameDomainOnly: true,           // Only follow links on the same domain (default: true)
  maxPagesPerDomain: 20,          // Cap pages per domain (default: 10)
});

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  sources: [webSource],
  embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
  description: 'Web documentation and guides.',
});
```

**Features:**
- Recursive website crawling with depth control
- Automatic HTML text extraction (removes scripts/styles)
- Link discovery and following
- Respectful crawling with configurable delays
- Metadata includes title, URL, and source type

### API Data Sources

Index data from REST APIs with pagination support.

```typescript
import { ApiDataSource } from '@toolpack-sdk/knowledge';

const apiSource = new ApiDataSource('https://api.github.com/repos/toolpack-ai/toolpack-sdk/issues', {
  headers: {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
  },
  pagination: {
    param: 'page',
    start: 1,
    maxPages: 5,
  },
  dataPath: '',  // Root level array
  contentExtractor: (issue: any) => `${issue.title}\n\n${issue.body}`,
  metadataExtractor: (issue: any) => ({
    id: issue.id,
    state: issue.state,
    labels: issue.labels?.map(l => l.name),
  }),
});

const kb = await Knowledge.create({
  provider: new PersistentKnowledgeProvider({ namespace: 'github-issues' }),
  sources: [apiSource],
  embedder: new OpenAIEmbedder({ model: 'text-embedding-3-small' }),
  description: 'GitHub issues and discussions.',
});
```

**Features:**
- REST API data ingestion (GET/POST)
- Automatic pagination handling
- Custom content and metadata extractors
- JSON path support for nested data
- Flexible data transformation

### Streaming Ingestion

Process large datasets efficiently with batch processing.

```typescript
const kb = await Knowledge.create({
  provider: new PersistentKnowledgeProvider({ namespace: 'large-dataset' }),
  sources: [new ApiDataSource('https://api.example.com/large-dataset')],
  embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
  streamingBatchSize: 50,  // Process 50 chunks at a time
  description: 'Large dataset with streaming ingestion.',
  onEmbeddingProgress: (event) => {
    console.log(`Processed: ${event.current}/${event.total} chunks`);
  },
});
```

### Hybrid Search

Combine semantic and keyword search for better results.

```typescript
// Semantic search (default)
const semanticResults = await kb.query('machine learning algorithms', {
  searchType: 'semantic',
  limit: 5,
});

// Keyword search
const keywordResults = await kb.query('machine learning algorithms', {
  searchType: 'keyword',
  limit: 5,
});

// Hybrid search (recommended)
const hybridResults = await kb.query('machine learning algorithms', {
  searchType: 'hybrid',
  semanticWeight: 0.7,  // 70% semantic, 30% keyword
  limit: 5,
});
```

**Search Types:**
- `semantic` — Vector similarity search (default)
- `keyword` — Text matching search
- `hybrid` — Combined semantic + keyword search

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

### WebUrlSource

Crawl and index web pages with HTML parsing.

```typescript
new WebUrlSource(['https://example.com', 'https://docs.example.com'], {
  maxDepth: 2,                    // Crawl depth (default: 1)
  delayMs: 1000,                  // Delay between requests (default: 1000ms)
  userAgent: 'MyApp/1.0',         // Custom user agent
  maxChunkSize: 2000,             // Max tokens per chunk
  chunkOverlap: 200,              // Overlap between chunks
  timeoutMs: 30000,               // Request timeout (default: 30000ms)
  sameDomainOnly: true,           // Only follow links on the same domain (default: true)
  maxPagesPerDomain: 10,          // Max pages crawled per domain (default: 10)
  namespace: 'web',               // Chunk ID prefix
  metadata: { source: 'web' },    // Added to all chunks
})
```

**Features:**
- Recursive website crawling
- Automatic HTML text extraction
- Link discovery and following
- Respectful crawling with delays
- Error handling for failed requests

### ApiDataSource

Index data from REST APIs with pagination.

```typescript
new ApiDataSource('https://api.example.com/data', {
  method: 'GET',                  // HTTP method (default: 'GET')
  headers: {                      // Request headers
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),       // Request body for POST
  pagination: {                   // Pagination config
    param: 'page',                // Query param name
    start: 1,                     // Starting page number
    step: 1,                      // Page increment
    maxPages: 10,                 // Max pages to fetch
  },
  dataPath: 'data.items',         // JSON path to data array
  contentExtractor: (item) =>     // Custom content extraction
    `${item.title}\n\n${item.description}`,
  metadataExtractor: (item) => ({ // Custom metadata extraction
    id: item.id,
    category: item.category,
  }),
  maxChunkSize: 2000,             // Max tokens per chunk
  chunkOverlap: 200,              // Overlap between chunks
  timeoutMs: 30000,               // Request timeout
  namespace: 'api',               // Chunk ID prefix
  metadata: { source: 'api' },    // Added to all chunks
})
```

**Features:**
- REST API data ingestion
- Automatic pagination handling
- Custom data extractors
- JSON path support
- Flexible content transformation

### JSONSource

Index data from local JSON files.

```typescript
import { JSONSource } from '@toolpack-sdk/knowledge';

new JSONSource('./data/products.json', {
  toContent: (item: any) => `${item.name}\n\n${item.description}`,  // Required
  filter: (item: any) => item.active === true,                       // Optional: filter items
  chunkSize: 100,                                                     // Items per chunk (default: 100)
  namespace: 'products',
  metadata: { source: 'products-db' },
})
```

**Features:**
- Parses JSON arrays (or single objects)
- Optional item-level filtering
- Required `toContent` callback to control what gets embedded

### SQLiteSource

Index rows from a SQLite database. Requires `better-sqlite3`.

```typescript
import { SQLiteSource } from '@toolpack-sdk/knowledge';

new SQLiteSource('./data/app.db', {
  query: 'SELECT id, title, body FROM articles WHERE published = 1',  // Optional: defaults to all rows
  toContent: (row) => `${row.title}\n\n${row.body}`,                  // Required
  chunkSize: 50,                                                        // Rows per chunk (default: 100)
  namespace: 'articles',
  metadata: { source: 'sqlite' },
  preLoadCSV: {                   // Optional: load a CSV into the DB before querying
    tableName: 'articles',
    csvPath: './data/articles.csv',
    delimiter: ',',
    headers: true,
  },
})
```

### PostgresSource

Index rows from a PostgreSQL database. Requires `pg`.

```typescript
import { PostgresSource } from '@toolpack-sdk/knowledge';

new PostgresSource({
  connectionString: process.env.DATABASE_URL,  // or use host/port/database/user/password
  query: 'SELECT id, title, content FROM docs WHERE status = $1',
  toContent: (row) => `${row.title}\n\n${row.content}`,  // Required
  chunkSize: 50,
  namespace: 'docs',
  metadata: { source: 'postgres' },
  ssl: true,
})
```

## Embedders

### OllamaEmbedder

Local embeddings via Ollama. Zero API cost.

```typescript
new OllamaEmbedder({
  model: 'nomic-embed-text',           // or 'mxbai-embed-large', 'all-minilm', 'bge-m3', etc.
  baseUrl: 'http://localhost:11434',   // default
  dimensions: 768,                     // optional: override auto-detected dimensions
  retries: 3,                          // default
  retryDelay: 1000,                    // ms, default
})
```

Known models: `nomic-embed-text` (768), `mxbai-embed-large` (1024), `all-minilm` (384), `snowflake-arctic-embed` (1024), `bge-m3` (1024), `bge-large` (1024). Pass `dimensions` for any other model.

### OpenRouterEmbedder

Embeddings via OpenRouter, giving access to OpenAI embedding models through a single API key.

```typescript
import { OpenRouterEmbedder } from '@toolpack-sdk/knowledge';

new OpenRouterEmbedder({
  model: 'openai/text-embedding-3-small',  // or 'openai/text-embedding-3-large', 'openai/text-embedding-ada-002'
  apiKey: process.env.OPENROUTER_API_KEY!,
  dimensions: 1536,                         // optional: override auto-detected dimensions
  retries: 3,                               // default
  retryDelay: 1000,                         // ms, default
})
```

Known models: `openai/text-embedding-3-small` (1536), `openai/text-embedding-3-large` (3072), `openai/text-embedding-ada-002` (1536). Pass `dimensions` for any other model.

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
  streamingBatchSize?: number;                // Process chunks in batches (default: 100)
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
  searchType: 'hybrid',   // 'semantic' | 'keyword' | 'hybrid' (default: 'semantic')
  semanticWeight: 0.7,    // Weight for semantic vs keyword in hybrid search (0-1)
  filter: {               // Metadata filters
    hasCode: true,
    category: { $in: ['api', 'guide'] },
  },
  includeMetadata: true,  // default
  includeVectors: false,  // default
});
```

### Utility Functions

```typescript
import { keywordSearch, combineScores } from '@toolpack-sdk/knowledge';

// Manual keyword search
const score = keywordSearch('document content', 'search query');
// Returns: number between 0-1

// Combine semantic and keyword scores
const combinedScore = combineScores(semanticScore, keywordScore, 0.7);
// Returns: weighted combination
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
