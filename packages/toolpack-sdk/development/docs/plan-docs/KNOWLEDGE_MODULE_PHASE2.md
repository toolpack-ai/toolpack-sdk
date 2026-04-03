# Toolpack SDK — Knowledge Module: Phase 2 (Advanced)

> **Scope:** External providers, hybrid search, production features, and ecosystem extensibility.

---

## Overview

Phase 2 extends the knowledge module with production-grade features: external vector databases, hybrid search, reranking, and community extensibility. These features add complexity and infrastructure requirements — they are opt-in for developers who need scale.

**What ships in Phase 2:**
- `ChromaProvider` — local/self-hosted Chroma vector DB
- `PgVectorProvider` — Postgres-native vector storage
- `QdrantProvider` — high-performance vector DB
- `GeminiEmbedder` — Google Gemini embeddings
- Hybrid search (vector + BM25)
- Reranking hooks
- Provider health checks and stats
- Obsidian vault support
- Community provider/source package patterns

**Prerequisites:** Phase 1 must be complete. All Phase 2 features build on the core interfaces.

---

## External Providers

### ChromaProvider

Local or self-hosted Chroma vector database.

```ts
import { Knowledge, ChromaProvider, MarkdownSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new ChromaProvider({
    url: 'http://localhost:8000',
    collection: 'docs',
    apiKey: process.env.CHROMA_API_KEY,  // optional, for cloud
  }),
  source: new MarkdownSource('./docs/**/*.md'),
});
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | Chroma server URL |
| `collection` | `string` | Collection name |
| `apiKey` | `string` | API key (optional, for Chroma Cloud) |
| `tenant` | `string` | Tenant ID (optional) |
| `database` | `string` | Database name (optional) |

#### Implementation Notes

- Uses Chroma's REST API
- Supports Chroma's native metadata filtering
- Collection created automatically if it doesn't exist
- Hybrid search via Chroma's `where_document` parameter

#### Dependencies

- `chromadb` npm package or raw HTTP client

---

### PgVectorProvider

Postgres-native vector storage using the `pgvector` extension.

```ts
import { Knowledge, PgVectorProvider, MarkdownSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new PgVectorProvider({
    connectionString: process.env.DATABASE_URL,
    table: 'knowledge_chunks',
    dimensions: 1536,  // must match embedder
  }),
  source: new MarkdownSource('./docs/**/*.md'),
});
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `connectionString` | `string` | Postgres connection string |
| `table` | `string` | Table name for chunks |
| `dimensions` | `number` | Vector dimensions (must match embedder) |
| `schema` | `string` | Schema name (default: `public`) |
| `indexType` | `'ivfflat'` \| `'hnsw'` | Index type (default: `hnsw`) |

#### Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

#### Implementation Notes

- Auto-creates table and index if they don't exist
- Uses `pg` package (already in package.json)
- Metadata filtering via JSONB operators
- Hybrid search via `pg_trgm` + `tsvector`

---

### QdrantProvider

High-performance vector database, self-hosted or cloud.

```ts
import { Knowledge, QdrantProvider, MarkdownSource } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new QdrantProvider({
    url: 'http://localhost:6333',
    collection: 'docs',
    apiKey: process.env.QDRANT_API_KEY,  // optional, for cloud
  }),
  source: new MarkdownSource('./docs/**/*.md'),
});
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | Qdrant server URL |
| `collection` | `string` | Collection name |
| `apiKey` | `string` | API key (optional) |
| `https` | `boolean` | Use HTTPS (default: auto-detect) |
| `onDiskPayload` | `boolean` | Store payload on disk (default: false) |

#### Implementation Notes

- Uses Qdrant's REST API
- Collection created with auto-detected dimensions
- Native hybrid search support via Qdrant's sparse vectors
- Efficient metadata filtering

#### Dependencies

- `@qdrant/js-client-rest` or raw HTTP client

---

## GeminiEmbedder

Google Gemini embedding models.

```ts
import { Knowledge, MemoryProvider, MarkdownSource, GeminiEmbedder } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
  embedder: new GeminiEmbedder({
    model: 'text-embedding-004',
    apiKey: process.env.GEMINI_API_KEY,
  }),
});
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `model` | `string` | Model name (default: `text-embedding-004`) |
| `apiKey` | `string` | Gemini API key |
| `retries` | `number` | Max retry attempts (default: 3) |
| `timeout` | `number` | Request timeout in ms (default: 30000) |

#### Implementation Notes

- Uses `@google/generative-ai` (already in package.json)
- Batch embedding support
- 768 dimensions for `text-embedding-004`

---

## Hybrid Search

Combines vector similarity with BM25 keyword matching. **Opt-in only.**

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

### Options

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | `boolean` | Enable hybrid search (default: false) |
| `vectorWeight` | `number` | Weight for vector similarity (default: 0.7) |
| `keywordWeight` | `number` | Weight for BM25 (default: 0.3) |

### How It Works

1. Query sent to both vector search and BM25 index
2. Results normalized and combined using Reciprocal Rank Fusion (RRF)
3. Final ranking reflects both semantic relevance and keyword presence

### Provider Support

| Provider | Hybrid Implementation |
|----------|----------------------|
| `MemoryProvider` | Built-in BM25 index |
| `PgVectorProvider` | `pg_trgm` + `tsvector` |
| `ChromaProvider` | Chroma's native `where_document` |
| `QdrantProvider` | Qdrant's sparse vectors |

### Tradeoffs

| Factor | Vector-Only | Hybrid |
|--------|-------------|--------|
| **Query latency** | 1 index lookup | 2 index lookups + merge |
| **Storage** | Vectors only | Vectors + BM25 index (~20-40% more) |
| **Memory** | Lower | Higher |
| **Complexity** | Simple | Weight tuning required |

### When to Use

**Skip hybrid search:**
- Small knowledge bases (<1000 chunks)
- Latency-critical applications
- Semantic-only queries

**Use hybrid search:**
- Technical documentation with specific terms (API names, error codes)
- Mixed queries (concepts + exact terms)
- Large knowledge bases with recall gaps

---

## Reranking

Optional reranking step to improve result quality.

```ts
import { Knowledge, PgVectorProvider, MarkdownSource, CohereReranker } from 'toolpack-sdk';

const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
  reranker: new CohereReranker({
    apiKey: process.env.COHERE_API_KEY,
    model: 'rerank-english-v3.0',
    topN: 5,  // return top 5 after reranking
  }),
});
```

### Built-in Rerankers

| Class | Description |
|-------|-------------|
| `CohereReranker` | Cohere Rerank API |
| `CrossEncoderReranker` | Local cross-encoder model via Ollama |

### Reranker Interface

```ts
interface Reranker {
  rerank(query: string, chunks: Chunk[], options?: RerankOptions): Promise<Chunk[]>;
}

interface RerankOptions {
  topN?: number;  // number of results to return
}
```

### How It Works

1. Initial retrieval returns `limit * 3` candidates (over-fetch)
2. Reranker scores each candidate against the query
3. Top `limit` results returned after reranking

### Tradeoffs

- **Latency:** Adds 100-500ms per query
- **Cost:** Cohere charges per rerank call
- **Quality:** Significant improvement for complex queries

---

## Provider Health Checks

Monitor provider status and statistics.

```ts
// Check if provider is reachable
const isHealthy = await kb.provider.healthCheck();

// Get provider stats
const stats = await kb.provider.stats();
// {
//   totalChunks: 1523,
//   indexSize: '45MB',
//   lastSync: Date,
//   providerVersion: '0.4.0',
// }
```

### KnowledgeProvider Extended Interface

```ts
interface KnowledgeProvider {
  // ... Phase 1 methods ...
  
  // Phase 2 additions
  healthCheck(): Promise<boolean>;
  stats(): Promise<ProviderStats>;
}

interface ProviderStats {
  totalChunks: number;
  indexSize?: string;
  lastSync?: Date;
  providerVersion?: string;
}
```

---

## Obsidian Vault Support

Enhanced `MarkdownSource` for Obsidian vaults.

```ts
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./vault/**/*.md', {
    obsidian: true,  // enable Obsidian features
  }),
});
```

### Features

- **Wikilinks:** `[[Page Name]]` resolved to actual file paths
- **Tags:** `#tag` extracted as metadata
- **Graph links:** Backlinks and forward links as metadata
- **Aliases:** Frontmatter aliases supported
- **Embeds:** `![[Embedded Note]]` content inlined

### Chunk Metadata

```ts
{
  content: "...",
  metadata: {
    heading: ['Project', 'Setup'],
    tags: ['dev', 'setup'],
    links: ['Getting Started', 'Installation'],
    backlinks: ['Index', 'Overview'],
    aliases: ['project-setup'],
  }
}
```

---

## Partial Ingestion Recovery

Resume ingestion after failures.

```ts
const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
  onError: (error, context) => {
    console.error(`Failed: ${context.file}: ${error.message}`);
    return 'skip';  // 'skip' | 'retry' | 'abort'
  },
});

// Resume from last successful checkpoint
await kb.sync({ resume: true });
```

### Checkpoint Storage

- Checkpoints stored in provider (if supported) or local file
- Format: `{ lastFile: string, lastChunkId: string, timestamp: Date }`
- Cleared on successful full sync

---

## Custom Providers

Community packages can implement the `KnowledgeProvider` interface:

```ts
import { KnowledgeProvider, Chunk, QueryOptions, QueryResult } from 'toolpack-sdk';

export class WeaviateProvider implements KnowledgeProvider {
  constructor(private options: WeaviateOptions) {}

  async add(chunks: Chunk[]): Promise<void> { /* ... */ }
  async query(text: string, options?: QueryOptions): Promise<QueryResult[]> { /* ... */ }
  async delete(ids: string[]): Promise<void> { /* ... */ }
  async clear(): Promise<void> { /* ... */ }
  async healthCheck(): Promise<boolean> { /* ... */ }
  async stats(): Promise<ProviderStats> { /* ... */ }
}
```

### Publishing

```json
{
  "name": "toolpack-knowledge-weaviate",
  "peerDependencies": {
    "toolpack-sdk": "^1.0.0"
  }
}
```

### Usage

```ts
import { Knowledge, MarkdownSource } from 'toolpack-sdk';
import { WeaviateProvider } from 'toolpack-knowledge-weaviate';

const kb = await Knowledge.create({
  provider: new WeaviateProvider({ url: '...', apiKey: '...' }),
  source: new MarkdownSource('./docs/**/*.md'),
});
```

---

## Custom Sources

Community packages can implement the `KnowledgeSource` interface:

```ts
import { KnowledgeSource, Chunk, ChunkUpdate } from 'toolpack-sdk';

export class NotionSource implements KnowledgeSource {
  constructor(private options: NotionOptions) {}

  async *load(): AsyncIterable<Chunk> {
    const pages = await fetchNotionPages(this.options);
    for (const page of pages) {
      yield {
        id: `notion:${page.id}`,
        content: page.text,
        metadata: { title: page.title, url: page.url },
      };
    }
  }

  async *watch(): AsyncIterable<ChunkUpdate> {
    // Poll Notion API for changes
  }
}
```

### Potential Community Sources

- `toolpack-knowledge-notion` — Notion pages
- `toolpack-knowledge-confluence` — Confluence pages
- `toolpack-knowledge-github` — GitHub issues/discussions
- `toolpack-knowledge-slack` — Slack message history

---

## Error Handling (Extended)

### Additional Error Types

```ts
import { 
  ProviderConnectionError,
  ProviderTimeoutError,
  RerankError,
  HybridSearchError,
} from 'toolpack-sdk';

try {
  await kb.query('...');
} catch (error) {
  if (error instanceof ProviderConnectionError) {
    // Vector DB unreachable
  } else if (error instanceof ProviderTimeoutError) {
    // Query timed out
  } else if (error instanceof RerankError) {
    // Reranker API failed — fallback to unreranked results
  }
}
```

### Graceful Degradation

```ts
const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
  hybridSearch: { enabled: true },
  reranker: new CohereReranker({ apiKey: process.env.COHERE_API_KEY }),
  fallback: {
    onHybridFailure: 'vector-only',  // fallback to vector search
    onRerankFailure: 'skip',          // return unreranked results
  },
});
```

---

## Implementation Checklist

### Providers
- [ ] `ChromaProvider` with REST API client
- [ ] `PgVectorProvider` with auto-schema creation
- [ ] `QdrantProvider` with REST API client
- [ ] Provider health checks and stats

### Embedders
- [ ] `GeminiEmbedder` with batch support

### Hybrid Search
- [ ] BM25 index for `MemoryProvider`
- [ ] `tsvector` integration for `PgVectorProvider`
- [ ] Native hybrid for Chroma/Qdrant
- [ ] RRF score fusion

### Reranking
- [ ] `CohereReranker` with API client
- [ ] `CrossEncoderReranker` with Ollama
- [ ] Over-fetch and rerank pipeline

### Obsidian
- [ ] Wikilink resolution
- [ ] Tag extraction
- [ ] Graph link metadata
- [ ] Embed inlining

### Recovery
- [ ] Checkpoint storage
- [ ] Resume sync
- [ ] Graceful degradation

### Ecosystem
- [ ] Provider interface documentation
- [ ] Source interface documentation
- [ ] Example community packages

---

## Testing Strategy

### Unit Tests
- Provider implementations with mocked APIs
- Hybrid search score fusion
- Reranker pipeline
- Obsidian parser features

### Integration Tests
- Real Chroma/PgVector/Qdrant instances (Docker)
- End-to-end hybrid search
- Reranking with mock API
- Checkpoint and resume

### Performance Tests
- Query latency benchmarks
- Hybrid vs vector-only comparison
- Reranking overhead measurement

---

## Dependencies

**Already in package.json:**
- `pg` — Postgres client
- `@google/generative-ai` — Gemini embeddings

**To add:**
- `@qdrant/js-client-rest` — Qdrant client (or raw HTTP)
- `chromadb` — Chroma client (or raw HTTP)
- `cohere-ai` — Cohere reranker (optional)

---

## Migration from Phase 1

Phase 2 is fully backward compatible. Existing Phase 1 code works unchanged:

```ts
// Phase 1 code — still works
const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  source: new MarkdownSource('./docs/**/*.md'),
});

// Phase 2 upgrade — just swap provider
const kb = await Knowledge.create({
  provider: new PgVectorProvider({ connectionString: process.env.DATABASE_URL }),
  source: new MarkdownSource('./docs/**/*.md'),
});
```

---

## Competitive Positioning

### vs. LangChain / LlamaIndex

Toolpack's edge is **philosophy, not features**:

- No mandatory infra to get started — `MemoryProvider` works out of the box
- Unified mental model — named class exports are already familiar
- First-class tool integration — knowledge as an agent tool is natural
- TypeScript-first — not a Python library awkwardly translated to JS

### vs. Vercel AI SDK

Closest in philosophy. Clean API, multi-provider, TypeScript-first. But minimal knowledge/RAG story — Toolpack fills this gap.

### What Not to Compete On

- Scale and performance — be the best *interface* to Chroma, PgVector, Qdrant
- Research features — graph RAG, ColBERT, HyperDimensional Computing
- Breadth of integrations — pick 4-5 and do them really well

### One-Line Positioning

> LangChain/LlamaIndex for developers who want power. **Toolpack for developers who want to ship.**

---

*Phase 2 Target: Production-ready knowledge module with external providers and advanced retrieval features.*
