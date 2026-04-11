import * as fs from 'fs/promises';
import * as path from 'path';
import { KnowledgeSource, Chunk } from '../interfaces.js';
import { IngestionError } from '../errors.js';

export interface JSONSourceOptions {
  namespace?: string;
  metadata?: Record<string, unknown>;
  filter?: (item: unknown) => boolean;
  chunkSize?: number;
  /** Required. Transform each JSON item into a human-readable string for AI embedding. */
  toContent: (item: unknown) => string;
}

/**
 * Knowledge source for JSON files.
 * Supports jq-like filtering and chunking of large arrays.
 */
export class JSONSource implements KnowledgeSource {
  private options: Required<JSONSourceOptions>;

  constructor(
    private filePath: string,
    options: JSONSourceOptions
  ) {
    if (!options.toContent) {
      throw new IngestionError(
        'JSONSource requires a toContent callback. Example: toContent: (item) => `Name: ${item.name}`',
        this.filePath
      );
    }
    this.options = {
      namespace: options.namespace ?? 'json',
      metadata: options.metadata ?? {},
      filter: options.filter ?? (() => true),
      chunkSize: options.chunkSize ?? 100,
      toContent: options.toContent,
    };
  }

  async *load(): AsyncIterable<Chunk> {
    let data: unknown;

    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      data = JSON.parse(content);
    } catch (error) {
      throw new IngestionError(
        `Failed to parse JSON file: ${(error as Error).message}`,
        this.filePath
      );
    }

    // Handle array data with optional filtering
    if (Array.isArray(data)) {
      const filtered = data.filter(this.options.filter);
      
      // Transform each item using toContent and join
      const contentItems = filtered.map(this.options.toContent);
      
      // Chunk large arrays
      for (let i = 0; i < contentItems.length; i += this.options.chunkSize) {
        const chunkItems = contentItems.slice(i, i + this.options.chunkSize);
        const chunkContent = chunkItems.join('\n\n---\n\n');
        
        yield {
          id: `json:${this.options.namespace}:${i}`,
          content: chunkContent,
          metadata: {
            ...this.options.metadata,
            source: path.basename(this.filePath),
            type: 'json_array_chunk',
            startIndex: i,
            endIndex: Math.min(i + this.options.chunkSize, contentItems.length),
            totalItems: contentItems.length,
          },
        };
      }
    } else {
      // Single object - use toContent if it's an object
      const content = typeof data === 'object' && data !== null
        ? this.options.toContent(data)
        : typeof data === 'string'
          ? data
          : JSON.stringify(data);
      
      yield {
        id: `json:${this.options.namespace}:0`,
        content,
        metadata: {
          ...this.options.metadata,
          source: path.basename(this.filePath),
          type: 'json_object',
        },
      };
    }
  }
}
