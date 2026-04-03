# Toolpack SDK — Knowledge Module: Phase 1 Implementation

> **Scope:** In-memory provider with core sources (Markdown, JSON, SQLite). Zero external dependencies. Ship fast.

---

## Overview

Phase 1 delivers a fully functional knowledge module that works out of the box with no infrastructure setup. Developers can prototype RAG applications immediately using `MemoryProvider` and built-in sources.

**What ships in Phase 1:**
- `Knowledge` — main entry point
- `MemoryProvider` — in-memory vector storage
- `MarkdownSource` — heading-aware markdown chunking
- `JSONSource` — JSON record chunking
- `SQLiteTextSource` — semantic search for text-heavy SQLite tables
- `OllamaEmbedder` — local embeddings (zero API cost)
- `OpenAIEmbedder` — cloud embeddings
- Agentic RAG integration with `Toolpack.init()`

---

## Core API

```ts
import { Knowledge, MemoryProvider, MarkdownSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md', { watch: true }),
});

// Use with Toolpack agent — knowledge becomes a first-class tool
const toolpack = await Toolpack.init({
  provider: 'anthropic',
  knowledge: kb,
});
```

---

## Interfaces

### KnowledgeProvider

```ts
interface KnowledgeProvider {
  add(chunks: Chunk[]): Promise<void>;
  query(text: string, options?: QueryOptions): Promise<QueryResult[]>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}
```

### QueryOptions

```ts
interface QueryOptions {
  limit?: number;              // max results (default: 10)
  threshold?: number;          // min similarity score 0-1 (default: 0.7)
  filter?: MetadataFilter;     // filter by chunk metadata
  includeMetadata?: boolean;   // include metadata in results (default: true)
  includeVectors?: boolean;    // include raw vectors (default: false)
}

interface MetadataFilter {
  [key: string]: string | number | boolean | { $in: any[] } | { $gt: number } | { $lt: number };
}

interface QueryResult {
  chunk: Chunk;
  score: number;               // similarity score 0-1
  distance?: number;           // raw vector distance (if available)
}
```

### KnowledgeSource

```ts
interface KnowledgeSource {
  load(): AsyncIterable<Chunk>;
  watch?(): AsyncIterable<ChunkUpdate>;  // optional, for file-based sources
}

interface Chunk {
  id: string;
  content: string;
  metadata: Record<string, any>;
  vector?: number[];  // populated by embedder
}

interface ChunkUpdate {
  type: 'add' | 'update' | 'delete';
  chunk: Chunk;
}
```

### Embedder

```ts
interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}
```

---

## MemoryProvider

Zero-config, in-memory vector storage using cosine similarity.

```ts
import { Knowledge, MemoryProvider, MarkdownSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
});
```

### Implementation Notes

- Uses brute-force cosine similarity (fast enough for <10k chunks)
- Vectors stored in a `Map<string, { chunk: Chunk, vector: number[] }>`
- No persistence — data lost on process exit
- Thread-safe for concurrent queries

### Options

```ts
new MemoryProvider({
  maxChunks?: number;  // optional limit to prevent memory issues
})
```

---

## MarkdownSource

Chunks markdown files by heading hierarchy, not token count.

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md', {
    watch: true,          // re-index on file changes
    maxChunkSize: 2000,   // max tokens per chunk (default: 2000)
    chunkOverlap: 200,    // overlap tokens between chunks (default: 200)
    minChunkSize: 100,    // minimum tokens to form a chunk (default: 100)
  }),
});
```

### Chunk Size Handling

- If a heading section exceeds `maxChunkSize`, split at paragraph boundaries
- If no paragraph boundary exists, split at sentence boundaries
- `chunkOverlap` ensures context continuity across splits
- Sections smaller than `minChunkSize` are merged with the next sibling section

### Parser Features

- Chunks by heading hierarchy, preserving full heading path as metadata
- Extracts frontmatter as filterable metadata (`tags`, `author`, `date`, etc.)
- Tags chunks that contain code blocks separately from prose
- Supports `[[wikilinks]]` and `#tags` for Obsidian-flavored markdown

### Example Chunk

```ts
{
  id: "docs:getting-started.md:a1b2c3d4",
  content: "Install the package using npm...",
  metadata: {
    heading: ['Getting Started', 'Installation'],
    tags: ['setup', 'npm'],
    hasCode: true,
    source: 'docs/getting-started.md',
    chunkIndex: 0,
    totalChunks: 3,
  }
}
```

### Implementation Dependencies

- `fast-glob` — file matching (already in package.json)
- `chokidar` or native `fs.watch` — file watching
- Custom markdown parser (no heavy dependencies like remark)

---

## JSONSource

Chunks JSON files by declared structure.

```ts
import { Knowledge, MemoryProvider, JSONSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new JSONSource('./data/products.json', {
    chunkBy: 'item',                         // each array element = one chunk
    // or chunkBy: '$.products[*]',          // JSONPath expression
    contentFields: ['title', 'description'], // fields to embed
    metadataFields: ['id', 'category'],      // fields to filter by
  }),
});
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `chunkBy` | `'item'` \| JSONPath | How to split the JSON into chunks |
| `contentFields` | `string[]` | Fields to concatenate for embedding |
| `metadataFields` | `string[]` | Fields to include as filterable metadata |
| `watch` | `boolean` | Re-index on file changes |

### Path Flattening Fallback

For deeply nested JSON without a declared schema, the adapter falls back to path-flattening:

```ts
// Input: { "api": { "auth": { "description": "OAuth2 flow" } } }
// Output chunk content: "api.auth.description: OAuth2 flow"
```

### Implementation Dependencies

- Native `JSON.parse`
- Optional: `jsonpath-plus` for JSONPath expressions

---

## SQLiteTextSource

Semantic search for text-heavy SQLite tables.

```ts
import { Knowledge, MemoryProvider, SQLiteTextSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new SQLiteTextSource('./app.db', {
    table: 'articles',
    contentColumns: ['title', 'body'],      // columns to embed
    metadataColumns: ['id', 'author', 'created_at'],
  }),
});
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `table` | `string` | Table name to read from |
| `contentColumns` | `string[]` | Columns to concatenate for embedding |
| `metadataColumns` | `string[]` | Columns to include as metadata |
| `where` | `string` | Optional WHERE clause to filter rows |
| `watch` | `boolean` | Poll for changes (SQLite has no native watch) |
| `pollInterval` | `number` | Poll interval in ms (default: 5000) |

### When to Use

Use `SQLiteTextSource` for **semantic similarity** queries:
- "Find articles similar to X"
- "Documentation about authentication"

Use `Tools.sqliteQuery()` for **exact value** queries:
- "Orders over $100 last month"
- "Users who signed up in March"

### Implementation Dependencies

- `better-sqlite3` — already in package.json

---

## Embedders

### OllamaEmbedder (Recommended for Phase 1)

Zero API cost, runs locally.

```ts
import { Knowledge, MemoryProvider, MarkdownSource, OllamaEmbedder } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
  embedder: new OllamaEmbedder({
    model: 'nomic-embed-text',  // or 'mxbai-embed-large'
    baseUrl: 'http://localhost:11434',  // default
  }),
});
```

### OpenAIEmbedder

Cloud embeddings for production.

```ts
new OpenAIEmbedder({
  model: 'text-embedding-3-small',  // or 'text-embedding-3-large'
  apiKey: process.env.OPENAI_API_KEY,
  retries: 3,
  retryDelay: 1000,
  timeout: 30000,
})
```

### Implementation Notes

- Embedder is decoupled from LLM provider
- Default embedder: `OllamaEmbedder` if Ollama is running, else `OpenAIEmbedder`
- Batch embedding for efficiency (`embedBatch`)

---

## Multi-Source Support

Combine multiple sources in a single knowledge base:

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  sources: [
    new MarkdownSource('./docs/**/*.md'),
    new JSONSource('./data/products.json', { chunkBy: 'item' }),
    new SQLiteTextSource('./app.db', { table: 'articles', contentColumns: ['body'] }),
  ],
});
```

### Source-Level Metadata

```ts
new MarkdownSource('./docs/**/*.md', {
  namespace: 'docs',                      // prefix for chunk IDs
  metadata: { type: 'documentation' },    // added to all chunks
})
```

---

## Incremental Updates

### Automatic Watch Mode

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md', { watch: true }),
});

// Changes are detected and indexed automatically
await kb.stop();  // clean up watchers
```

### Manual Sync

```ts
await kb.sync();                          // full re-sync
await kb.sync({ incremental: true });     // only changes since last sync
await kb.sync({ sources: ['docs'] });     // specific namespace
```

### Chunk ID Generation

Deterministic, content-based IDs for deduplication:

```ts
// Format: {namespace}:{source_path}:{content_hash}
// Example: "docs:getting-started.md:a1b2c3d4"
```

### Update Semantics

| File Event | Action |
|------------|--------|
| File created | New chunks added |
| File modified | Old chunks deleted, new chunks added |
| File deleted | Associated chunks deleted |
| File renamed | Treated as delete + create |

---

## Agentic RAG Integration

Knowledge integrates with Toolpack's tool system. The agent decides when to retrieve:

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
});

const toolpack = await Toolpack.init({
  provider: 'anthropic',
  knowledge: kb,   // registered as a tool the agent can call
});
```

### How It Works

1. `Knowledge` instance exposes a `toTool()` method
2. Tool is registered with name `knowledge_search`
3. Agent receives tool description with available metadata filters
4. Agent decides when retrieval is needed (not every turn)

---

## Error Handling

### Error Types

```ts
import { 
  KnowledgeError,
  EmbeddingError,
  IngestionError,
  ChunkTooLargeError,
} from 'toolpack-sdk';

try {
  await kb.sync();
} catch (error) {
  if (error instanceof EmbeddingError) {
    // Embedding failed — check Ollama/OpenAI
  } else if (error instanceof IngestionError) {
    // Source parsing failed
    console.log(error.file, error.cause);
  }
}
```

### Error Callback

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
  onError: (error, context) => {
    console.error(`Failed: ${context.file}: ${error.message}`);
    return 'skip';  // 'skip' | 'retry' | 'abort'
  },
});
```

---

## Query Examples

```ts
// Basic query
const results = await kb.query('how to install');

// With options
const results = await kb.query('authentication setup', {
  limit: 5,
  threshold: 0.8,
  filter: {
    type: 'documentation',
    hasCode: true,
  },
});

// Advanced filtering
const results = await kb.query('pricing', {
  filter: {
    category: { $in: ['billing', 'plans'] },
    version: { $gt: 2 },
  },
});
```

---

## Implementation Checklist

### Core
- [ ] `Knowledge` class with `create()` static method
- [ ] `KnowledgeProvider` interface
- [ ] `KnowledgeSource` interface
- [ ] `Embedder` interface
- [ ] `Chunk` and `QueryResult` types

### MemoryProvider
- [ ] In-memory vector storage with `Map`
- [ ] Cosine similarity search
- [ ] Metadata filtering
- [ ] `add()`, `query()`, `delete()`, `clear()` methods

### MarkdownSource
- [ ] Glob pattern file discovery
- [ ] Heading-based chunking
- [ ] Frontmatter extraction
- [ ] Chunk size limits and splitting
- [ ] Watch mode with file system events

### JSONSource
- [ ] JSON parsing with `chunkBy` option
- [ ] Content field concatenation
- [ ] Metadata field extraction
- [ ] JSONPath support (optional)
- [ ] Watch mode

### SQLiteTextSource
- [ ] SQLite connection via `better-sqlite3`
- [ ] Row-to-chunk conversion
- [ ] Metadata column extraction
- [ ] Poll-based watch mode

### Embedders
- [ ] `OllamaEmbedder` with HTTP client
- [ ] `OpenAIEmbedder` with retry logic
- [ ] Batch embedding support
- [ ] Auto-detection of available embedder

### Integration
- [ ] `toTool()` method for agentic RAG
- [ ] `Toolpack.init({ knowledge })` support
- [ ] Sync events and callbacks

### Error Handling
- [ ] Typed error classes
- [ ] `onError` callback with skip/retry/abort
- [ ] Graceful degradation

---

## Testing Strategy

### Unit Tests
- `MemoryProvider` — add, query, delete, filter operations
- `MarkdownSource` — chunking logic, frontmatter parsing
- `JSONSource` — chunkBy modes, field extraction
- `SQLiteTextSource` — row conversion, metadata
- Embedders — mock HTTP responses

### Integration Tests
- End-to-end: source → embedder → provider → query
- Watch mode with file changes
- Multi-source composition
- Agentic RAG with mock agent

### Fixtures
- Sample markdown files with various heading structures
- Sample JSON files (array, nested, flat)
- Sample SQLite database with text-heavy table

---

## Dependencies

**Already in package.json:**
- `better-sqlite3` — SQLite access
- `fast-glob` — file pattern matching
- `openai` — OpenAI embeddings

**To add:**
- `chokidar` — file watching (or use native `fs.watch`)
- `jsonpath-plus` — JSONPath expressions (optional)

---

## Out of Scope (Phase 2)

- External vector DB providers (Chroma, PgVector, Qdrant)
- Hybrid search (BM25 + vector)
- Reranking hooks
- Custom provider/source packages
- Obsidian vault features (graph links)
- Provider health checks and stats

---

*Phase 1 Target: Ship a working knowledge module with zero infrastructure requirements.*
