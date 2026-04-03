# Toolpack SDK — Knowledge Module Design

> A design document capturing the architecture, philosophy, and competitive positioning of the Knowledge module for Toolpack SDK.

---

## Overview

The Knowledge module adds retrieval-augmented capabilities to Toolpack SDK. It follows the same design philosophy as the core SDK — a clean, unified abstraction that works out of the box without forcing developers into infrastructure decisions on day one.

The module is built around two orthogonal concepts:

- **Provider** — where knowledge is stored and retrieved from
- **Source** — where data comes from and how it is chunked

Any source works with any provider. They are fully independent. Both follow the same named class export pattern used throughout the rest of Toolpack SDK — no string literals, no magic config keys.

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

No string identifiers. Full autocomplete. Options are scoped to each class — `new MarkdownSource(...)` only exposes options that make sense for markdown. Errors surface at compile time, not runtime.

---

## Providers

Providers handle storage and retrieval. They implement a simple interface:

```ts
interface KnowledgeProvider {
  add(chunks: Chunk[]): Promise<void>;
  query(text: string, options?: QueryOptions): Promise<QueryResult[]>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;  // remove all chunks
}

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

**Query examples:**

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

### Built-in Providers

| Class | Use Case |
|-------|----------|
| `MemoryProvider` | In-memory, zero config. Ideal for dev, CLI tools, short-lived agents |
| `ChromaProvider` | Local or self-hosted Chroma vector DB |
| `PgVectorProvider` | Postgres-native vector storage for production apps |
| `QdrantProvider` | High-performance, self-hosted or cloud vector DB |

### Usage Examples

```ts
new MemoryProvider()

new ChromaProvider({ url: 'http://localhost:8000', collection: 'docs' })

new PgVectorProvider({ connectionString: process.env.DATABASE_URL, table: 'knowledge_chunks' })

new QdrantProvider({ url: 'http://localhost:6333', apiKey: process.env.QDRANT_KEY, collection: 'docs' })
```

### Custom Providers

Implement the `KnowledgeProvider` interface and pass it directly — no registration, no plugin system:

```ts
import { KnowledgeProvider, Chunk, QueryOptions } from 'toolpack-sdk';

class WeaviateProvider implements KnowledgeProvider {
  constructor(private options: WeaviateOptions) {}

  async add(chunks: Chunk[]): Promise<void> { ... }
  async query(text: string, options?: QueryOptions): Promise<Chunk[]> { ... }
  async delete(ids: string[]): Promise<void> { ... }
}

// Drop it straight in
const kb = await Knowledge.create({
  provider: new WeaviateProvider({ url: '...', apiKey: '...' }),
  source: new MarkdownSource('./docs/**/*.md'),
});
```

Community packages can publish providers independently — e.g. `toolpack-knowledge-weaviate`, `toolpack-knowledge-pinecone` — and they compose with any source out of the box.

---

## Sources

Sources handle ingestion and chunking. They implement a simple interface:

```ts
interface KnowledgeSource {
  load(): AsyncIterable<Chunk>;
  watch?(): AsyncIterable<ChunkUpdate>;  // optional, for file-based sources
}
```

### Markdown (`MarkdownSource`)

Markdown files are first-class citizens. The source adapter chunks by **heading hierarchy**, not by token count — an H2 section is a natural knowledge unit.

```ts
import { Knowledge, MemoryProvider, MarkdownSource } from 'toolpack-sdk';

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

**Chunk size handling:**

- If a heading section exceeds `maxChunkSize`, it is split at paragraph boundaries
- If no paragraph boundary exists, it splits at sentence boundaries
- `chunkOverlap` ensures context continuity across splits
- Sections smaller than `minChunkSize` are merged with the next sibling section

```ts
// Example: Large section gets split while preserving heading context
{
  content: "Install the package using npm... [first 2000 tokens]",
  metadata: {
    heading: ['Getting Started', 'Installation'],
    chunkIndex: 0,
    totalChunks: 3,
  }
}
```

**What the parser does:**

- Chunks by heading hierarchy, preserving the full heading path as metadata
- Extracts frontmatter as filterable metadata (`tags`, `author`, `date`, etc.)
- Tags chunks that contain code blocks separately from prose
- Resolves relative links for vault-style knowledge bases (e.g. Obsidian)
- Supports `[[wikilinks]]` and `#tags` for Obsidian-flavored markdown

**Example chunk metadata:**
```ts
{
  content: "Install the package using npm...",
  metadata: {
    heading: ['Getting Started', 'Installation'],
    tags: ['setup', 'npm'],
    hasCode: true,
    source: 'docs/getting-started.md',
  }
}
```

### JSON (`JSONSource`)

JSON sources require declaring what a "chunk" is, since JSON is schema-free.

```ts
import { Knowledge, ChromaProvider, JSONSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new ChromaProvider({ url: 'http://localhost:8000', collection: 'products' }),
  source: new JSONSource('./data/products.json', {
    chunkBy: 'item',                         // each array element = one chunk
    // or chunkBy: '$.products[*]',          // JSONPath expression
    contentFields: ['title', 'description'], // fields to embed
    metadataFields: ['id', 'category'],      // fields to filter by
  }),
});
```

For deeply nested JSON without a declared schema, the adapter falls back to **path-flattening** — converting `api.auth.description` into a string with its key path as context.

### SQLite — Two Access Patterns

SQLite data falls into two categories that require different retrieval strategies. Toolpack provides both under clear, distinct names:

#### `SQLiteTextSource` — Semantic Search for Text-Heavy Data

Use when your SQLite tables contain prose, articles, or documents where **meaning matters more than structure**.

```ts
import { Knowledge, PgVectorProvider, SQLiteTextSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new SQLiteTextSource('./app.db', {
    table: 'articles',
    contentColumns: ['title', 'body'],      // columns to embed
    metadataColumns: ['id', 'author', 'created_at'],
  }),
});

// Query: "articles about machine learning"
// Returns: semantically similar articles
```

#### `Tools.sqliteQuery()` — Text-to-SQL for Structured Data

Use when your SQLite tables contain relational/transactional data where **exact values and aggregations matter**.

```ts
import { Toolpack, Tools } from 'toolpack-sdk';

const toolpack = await Toolpack.init({
  provider: 'anthropic',
  tools: [Tools.sqliteQuery('./app.db')],  // agent generates and runs SQL
});

// Query: "how many orders over $100 last month?"
// Agent generates: SELECT COUNT(*) FROM orders WHERE amount > 100 AND date > '2026-02-01'
```

#### Decision Flowchart

```
Is your query about MEANING or EXACT VALUES?
│
├─ MEANING (semantic similarity)
│  └─ Use SQLiteTextSource
│     Examples:
│     - "Find articles similar to X"
│     - "Documentation about authentication"
│     - "Blog posts mentioning performance"
│
└─ EXACT VALUES (filtering, aggregation, joins)
   └─ Use Tools.sqliteQuery()
      Examples:
      - "Orders over $100 last month"
      - "Users who signed up in March"
      - "Average order value by category"
```

#### Hybrid: Both Patterns Together

Some applications need both. A support system might use semantic search for knowledge articles but SQL for ticket lookups:

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new SQLiteTextSource('./support.db', {
    table: 'knowledge_articles',
    contentColumns: ['title', 'content'],
  }),
});

const toolpack = await Toolpack.init({
  provider: 'anthropic',
  knowledge: kb,
  tools: [
    Tools.sqliteQuery('./support.db', {
      allowedTables: ['tickets', 'users'],  // restrict access
      readOnly: true,
    }),
  ],
});
```

### When to use which approach

| Data Type | Strategy |
|-----------|----------|
| Markdown docs, notes, READMEs | `MarkdownSource` |
| JSON records with text fields | `JSONSource` |
| SQLite with text-heavy columns | `SQLiteTextSource` (semantic) |
| SQLite with structured/relational data | `Tools.sqlite()` (agent tool) |

### Custom Sources

Same pattern as custom providers — implement the interface, pass it in:

```ts
import { KnowledgeSource, Chunk, ChunkUpdate } from 'toolpack-sdk';

class NotionSource implements KnowledgeSource {
  constructor(private options: NotionOptions) {}

  async *load(): AsyncIterable<Chunk> {
    const pages = await fetchNotionPages(this.options);
    for (const page of pages) {
      yield {
        id: page.id,
        content: page.text,
        metadata: { title: page.title, url: page.url },
      };
    }
  }

  async *watch(): AsyncIterable<ChunkUpdate> { ... } // optional
}

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new NotionSource({ token: process.env.NOTION_TOKEN }),
});
```

---

## Multi-Source Support

Real-world knowledge bases often combine multiple data sources. Pass an array to compose them:

```ts
import { Knowledge, PgVectorProvider, MarkdownSource, JSONSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  sources: [
    new MarkdownSource('./docs/**/*.md'),
    new JSONSource('./data/products.json', { chunkBy: 'item' }),
    new MarkdownSource('./wiki/**/*.md', { watch: true }),
  ],
});
```

Each source is ingested independently. Chunk IDs are namespaced by source to avoid collisions. When any watched source updates, only that source is re-indexed.

**Source-level metadata:**

```ts
new MarkdownSource('./docs/**/*.md', {
  namespace: 'docs',        // prefix for chunk IDs
  metadata: { type: 'documentation' },  // added to all chunks from this source
})
```

---

## Incremental Updates

Knowledge bases need to stay in sync with their sources. The module provides both automatic and manual sync mechanisms.

### Automatic Watch Mode

File-based sources support `watch: true` for automatic re-indexing:

```ts
const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md', { watch: true }),
});

// Changes are detected and indexed automatically
// Call stop() to clean up watchers
await kb.stop();
```

### Manual Sync

For sources without watch support or when you need explicit control:

```ts
// Full re-sync — clears and re-indexes everything
await kb.sync();

// Incremental sync — only process changes since last sync
await kb.sync({ incremental: true });

// Sync specific sources (when using multi-source)
await kb.sync({ sources: ['docs'] });  // by namespace
```

### Chunk ID Generation

Chunk IDs are deterministic and content-based to enable deduplication:

```ts
// ID format: {namespace}:{source_path}:{content_hash}
// Example: "docs:getting-started.md:a1b2c3d4"
```

**Update semantics:**

| File Event | Action |
|------------|--------|
| File created | New chunks added |
| File modified | Old chunks deleted, new chunks added |
| File deleted | Associated chunks deleted |
| File renamed | Treated as delete + create |

### Sync Events

Monitor sync progress with event callbacks:

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
  onSync: (event) => {
    console.log(`${event.type}: ${event.file} (${event.chunksAffected} chunks)`);
  },
});
```

---

## Embedders

The embedder is decoupled from the LLM provider. Someone using Anthropic for generation might want local Ollama embeddings to save cost. Embedder is a separate named class — custom providers only deal with vectors and never need to implement embedding logic themselves.

```ts
import { Knowledge, PgVectorProvider, MarkdownSource, OpenAIEmbedder } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
  embedder: new OpenAIEmbedder({ model: 'text-embedding-3-small' }),
});
```

### Built-in Embedders

| Class | Description |
|-------|-------------|
| `OpenAIEmbedder` | OpenAI text-embedding models |
| `OllamaEmbedder` | Local embeddings via Ollama — zero API cost |
| `GeminiEmbedder` | Google Gemini embedding models |

---

## Hybrid Search

Vector search excels at semantic similarity but can miss exact keyword matches. Hybrid search combines vector retrieval with BM25 keyword search for better recall.

```ts
const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
  hybridSearch: {
    enabled: true,
    vectorWeight: 0.7,
    keywordWeight: 0.3,
  },
});
```

### How it works

1. Query is sent to both vector search and BM25 index
2. Results are normalized and combined using Reciprocal Rank Fusion (RRF)
3. Final ranking reflects both semantic relevance and keyword presence

### Provider support

| Provider | Hybrid Support |
|----------|----------------|
| `MemoryProvider` | Built-in BM25 index |
| `PgVectorProvider` | Uses `pg_trgm` + `tsvector` |
| `ChromaProvider` | Chroma's native hybrid mode |
| `QdrantProvider` | Qdrant's native hybrid mode |

For providers without native hybrid support, `HybridSearch` maintains a separate in-memory BM25 index.

### Tradeoffs: Complexity and Cost

Hybrid search improves recall but comes with real costs. Enable it via the `hybridSearch` option when you need it:

```ts
import { Knowledge, PgVectorProvider, MarkdownSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
  hybridSearch: {
    enabled: true,        // opt-in (default: false)
    vectorWeight: 0.7,    // weight for semantic similarity (default: 0.7)
    keywordWeight: 0.3,   // weight for BM25 keyword match (default: 0.3)
  },
});
```

| Factor | Vector-Only | Hybrid |
|--------|-------------|--------|
| **Query latency** | 1 index lookup | 2 index lookups + merge |
| **Storage** | Vectors only | Vectors + BM25 index (~20-40% more) |
| **Memory** | Lower | Higher (BM25 index in RAM for some providers) |
| **Complexity** | Simple | Weight tuning, RRF parameters |

**When to skip hybrid search:**

- Small knowledge bases (<1000 chunks) — vector search is usually sufficient
- Latency-critical applications — the extra lookup adds 10-50ms
- Cost-sensitive deployments — some providers charge per query
- Semantic-only queries — "find similar documents" doesn't benefit from keywords

**When hybrid is worth it:**

- Technical documentation with specific terms (API names, error codes)
- Mixed queries — users search both concepts ("authentication") and exact terms ("OAuth2")
- Large knowledge bases where vector search alone has recall gaps

**Recommendation:** Start with vector-only search. Add hybrid if you observe retrieval quality issues with keyword-heavy queries. The `search` option is optional — omit it for pure vector search:

```ts
// Default: vector-only (simpler, faster, cheaper)
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
});

// Opt-in: hybrid (better recall, more overhead)
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
  hybridSearch: { enabled: true },  // only when needed
});
```

---

## Agentic RAG

Knowledge integrates naturally with Toolpack's existing tool system. When a `knowledge` instance is passed to `Toolpack.init()`, the agent can decide **when** to retrieve, **what** to query, and **whether the result is sufficient** before proceeding — rather than always retrieving on every turn.

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
});

const toolpack = await Toolpack.init({
  provider: 'anthropic',
  knowledge: kb,   // registered as a tool the agent can call autonomously
});
```

This is different from naive RAG where the developer manually wires retrieval before every prompt. The agent reasons about retrieval as part of its plan.

---

## Error Handling

The Knowledge module uses typed errors and provides recovery mechanisms for common failure scenarios.

### Error Types

```ts
import { 
  KnowledgeError,
  EmbeddingError,
  ProviderConnectionError,
  IngestionError,
  ChunkTooLargeError,
} from 'toolpack-sdk';

try {
  await kb.sync();
} catch (error) {
  if (error instanceof EmbeddingError) {
    // Embedding API failed — retry or switch embedder
  } else if (error instanceof ProviderConnectionError) {
    // Vector DB unreachable — check connection
  } else if (error instanceof IngestionError) {
    // Source parsing failed — check file format
    console.log(error.file, error.cause);
  }
}
```

### Partial Ingestion Recovery

When ingestion fails mid-way, the module tracks progress and supports resumption:

```ts
const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
  onError: (error, context) => {
    // Called for each chunk/file that fails
    console.error(`Failed to ingest ${context.file}: ${error.message}`);
    return 'skip';  // 'skip' | 'retry' | 'abort'
  },
});

// Resume from last successful checkpoint
await kb.sync({ resume: true });
```

### Embedding Failures

Embedding APIs can fail due to rate limits or network issues. Built-in retry with exponential backoff:

```ts
new OpenAIEmbedder({
  model: 'text-embedding-3-small',
  retries: 3,           // max retry attempts (default: 3)
  retryDelay: 1000,     // initial delay in ms (default: 1000)
  timeout: 30000,       // request timeout in ms (default: 30000)
})
```

### Provider Health Checks

```ts
// Check if provider is reachable before operations
const isHealthy = await kb.provider.healthCheck();

// Get provider stats
const stats = await kb.provider.stats();
// { totalChunks: 1523, indexSize: '45MB', lastSync: Date }
```

---

## Extensibility and Ecosystem

Because both sides are plain interfaces, community packages compose naturally:

```ts
import { WeaviateProvider } from 'toolpack-knowledge-weaviate';
import { NotionSource } from 'toolpack-knowledge-notion';

const kb = await Knowledge.create({
  provider: new WeaviateProvider({ ... }),
  source: new NotionSource({ ... }),
});
```

A community provider works with every source. A community source works with every provider. Nobody needs to coordinate — the interfaces are the contract.

Potential community packages:
- `toolpack-knowledge-notion` — Notion pages as a source
- `toolpack-knowledge-weaviate` — Weaviate as a provider
- `toolpack-knowledge-obsidian` — Obsidian vault source with graph link resolution
- `toolpack-knowledge-confluence` — Confluence pages as a source

---

## Competitive Positioning

### vs. LangChain / LlamaIndex

These are the direct comparisons. They pioneered RAG abstractions but became notorious for over-engineering, excessive abstraction layers, and hard-to-debug chains. LlamaIndex in particular is knowledge/RAG focused.

Toolpack's edge is **philosophy, not features**:

- No mandatory infra to get started — `MemoryProvider` works out of the box
- Unified mental model — named class exports are already familiar to Toolpack users
- First-class tool integration — knowledge as an agent tool is natural, not bolted on
- TypeScript-first — not a Python library awkwardly translated to JS

### vs. Vercel AI SDK

Closest in philosophy. Clean API, multi-provider, TypeScript-first. But minimal knowledge/RAG story — a genuine gap Toolpack can fill.

### vs. vLLM

Not a competitor. vLLM is a high-performance inference engine for platform engineers. Toolpack is an application-layer SDK. A developer could run vLLM as a backend and use Toolpack as their application SDK simultaneously — they are complementary, not competing.

### What not to compete on

- Scale and performance — be the best *interface* to Chroma, PgVector, Qdrant. Don't build a vector DB.
- Research features — graph RAG, ColBERT reranking, HyperDimensional Computing. Let researchers use Python.
- Breadth of integrations on day one — LangChain has 300+ integrations and it's a liability. Pick 4-5 and do them really well.

### One-line positioning

> LangChain/LlamaIndex for developers who want power. **Toolpack for developers who want to ship.**

---

## Roadmap Suggestion

### v1
- `MemoryProvider` — zero config, in-process
- `MarkdownSource` — heading-aware chunking, frontmatter metadata, watch mode
- `OpenAIEmbedder` + `OllamaEmbedder`
- Knowledge as agent tool

### v2
- `JSONSource` with JSONPath chunking
- `ChromaProvider` and `PgVectorProvider`
- `SQLiteSource` for text-heavy tables

### v3
- Obsidian vault support (`[[wikilinks]]`, `#tags`, graph link resolution)
- `QdrantProvider`
- Pluggable reranking hook (Cohere, local cross-encoder)
- Community provider/source packages

---

*Document generated from design discussions — Toolpack SDK, March 2026.*