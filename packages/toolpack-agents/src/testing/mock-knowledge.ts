import type { Knowledge } from '@toolpack-sdk/knowledge';
import type { Chunk, Embedder, QueryOptions, QueryResult } from '@toolpack-sdk/knowledge';

/**
 * Options for creating mock knowledge.
 */
export interface MockKnowledgeOptions {
  /** Initial chunks to populate the knowledge base */
  initialChunks?: Array<{
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  /** Dimensions for the mock embedder (default: 384) */
  dimensions?: number;
  /** Description for the knowledge tool */
  description?: string;
}

/**
 * Creates an in-memory mock Knowledge instance for testing.
 * No embedder, no provider needed — everything is in-memory.
 *
 * @example
 * ```ts
 * const knowledge = createMockKnowledge({
 *   initialChunks: [
 *     { content: 'Lead: Acme Corp, score: 85', metadata: { source: 'crm' } },
 *   ],
 * });
 *
 * // Use with agent
 * const agent = new MyAgent(toolpack);
 * agent.knowledge = knowledge;
 * ```
 */
export async function createMockKnowledge(
  options: MockKnowledgeOptions = {}
): Promise<Knowledge> {
  const { Knowledge } = await import('@toolpack-sdk/knowledge');
  const { MemoryProvider } = await import('@toolpack-sdk/knowledge');

  const dimensions = options.dimensions ?? 384;

  // Create a mock embedder that generates pseudo-random vectors
  const mockEmbedder: Embedder = {
    dimensions,
    async embed(text: string): Promise<number[]> {
      // Generate a deterministic "random" vector based on the text
      const vector: number[] = [];
      let seed = 0;
      for (let i = 0; i < text.length; i++) {
        seed = (seed + text.charCodeAt(i)) % 1000;
      }
      for (let i = 0; i < dimensions; i++) {
        // Simple pseudo-random based on seed and position
        const val = Math.sin(seed * (i + 1)) * 0.5 + 0.5;
        vector.push(val);
      }
      return vector;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      return Promise.all(texts.map(t => this.embed(t)));
    },
  };

  const provider = new MemoryProvider();
  await provider.validateDimensions(dimensions);

  // Add initial chunks if provided
  if (options.initialChunks && options.initialChunks.length > 0) {
    const chunks: Chunk[] = [];
    for (const item of options.initialChunks) {
      const vector = await mockEmbedder.embed(item.content);
      chunks.push({
        id: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        content: item.content,
        metadata: item.metadata || {},
        vector,
      });
    }
    await provider.add(chunks);
  }

  return Knowledge.create({
    provider,
    embedder: mockEmbedder,
    sources: [],
    description: options.description ?? 'Mock knowledge base for testing',
    reSync: false,
  });
}

/**
 * Synchronous version of createMockKnowledge for simple test cases.
 * Returns a mock knowledge-like object that's not a full Knowledge instance
 * but implements the key methods needed for testing.
 *
 * This is useful when you don't want to deal with async setup in tests.
 */
export function createMockKnowledgeSync(
  options: MockKnowledgeOptions = {}
): MockKnowledge {
  const dimensions = options.dimensions ?? 384;
  const chunks: Chunk[] = [];

  // Generate deterministic vector
  const generateVector = (text: string): number[] => {
    const vector: number[] = [];
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed + text.charCodeAt(i)) % 1000;
    }
    for (let i = 0; i < dimensions; i++) {
      const val = Math.sin(seed * (i + 1)) * 0.5 + 0.5;
      vector.push(val);
    }
    return vector;
  };

  // Add initial chunks
  if (options.initialChunks) {
    for (const item of options.initialChunks) {
      chunks.push({
        id: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        content: item.content,
        metadata: item.metadata || {},
        vector: generateVector(item.content),
      });
    }
  }

  return new MockKnowledge(chunks, generateVector, options.description);
}

/**
 * A simplified mock Knowledge for synchronous test setup.
 * Implements the key methods that agents use: query() and add()
 */
export class MockKnowledge {
  private chunks: Chunk[];
  private generateVector: (text: string) => number[];
  private _description: string;

  constructor(
    initialChunks: Chunk[] = [],
    generateVector: (text: string) => number[],
    description = 'Mock knowledge base'
  ) {
    this.chunks = [...initialChunks];
    this.generateVector = generateVector;
    this._description = description;
  }

  /**
   * Query the mock knowledge base using simple keyword matching.
   * This doesn't do real semantic search but is sufficient for most tests.
   */
  async query(text: string, options?: QueryOptions): Promise<QueryResult[]> {
    const limit = options?.limit ?? 10;
    const filter = options?.filter;

    // Simple keyword matching
    const keywords = text.toLowerCase().split(/\s+/);

    let results = this.chunks
      .filter(chunk => {
        // Apply metadata filter if provided
        if (filter) {
          for (const [key, value] of Object.entries(filter)) {
            if (chunk.metadata[key] !== value) {
              return false;
            }
          }
        }
        return true;
      })
      .map(chunk => {
        const chunkText = chunk.content.toLowerCase();
        // Score based on keyword matches
        let score = 0;
        for (const keyword of keywords) {
          if (chunkText.includes(keyword)) {
            score += 0.3;
            // Bonus for exact word match
            if (new RegExp(`\\b${keyword}\\b`).test(chunkText)) {
              score += 0.2;
            }
          }
        }
        // Cap at 1.0
        score = Math.min(score, 1);

        return {
          chunk: {
            id: chunk.id,
            content: chunk.content,
            metadata: options?.includeMetadata === false ? {} : chunk.metadata,
            vector: options?.includeVectors ? chunk.vector : undefined,
          },
          score,
          distance: 1 - score,
        };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  /**
   * Add content to the mock knowledge base.
   */
  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.chunks.push({
      id,
      content,
      metadata: metadata || {},
      vector: this.generateVector(content),
    });
    return id;
  }

  /**
   * Get all chunks in the knowledge base.
   */
  getAllChunks(): Chunk[] {
    return [...this.chunks];
  }

  /**
   * Clear all chunks.
   */
  clear(): void {
    this.chunks = [];
  }

  /**
   * Convert to a tool format for use with agents.
   */
  toTool(): {
    name: string;
    displayName: string;
    description: string;
    category: string;
    cacheable: boolean;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    execute: (params: {
      query: string;
      limit?: number;
      threshold?: number;
      filter?: Record<string, unknown>;
    }) => Promise<Array<{ content: string; score: number; metadata: Record<string, unknown> }>>;
  } {
    return {
      name: 'knowledge_search',
      displayName: 'Knowledge Search',
      description: this._description,
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
      execute: async (params) => {
        const results = await this.query(params.query, {
          limit: params.limit,
          filter: params.filter as QueryOptions['filter'],
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
