import * as crypto from 'crypto';
import { KnowledgeSource, Chunk } from '../interfaces.js';
import { IngestionError } from '../errors.js';
import { estimateTokens, splitLargeChunk, applyOverlap } from '../utils/chunking.js';

export interface ApiDataSourceOptions {
  maxChunkSize?: number;
  chunkOverlap?: number;
  minChunkSize?: number;
  namespace?: string;
  metadata?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  pagination?: {
    param: string;
    start: number;
    step: number;
    maxPages?: number;
  } | null;
  dataPath?: string; // JSON path to extract data array (e.g., 'data.items')
  contentExtractor?: (item: unknown) => string;
  metadataExtractor?: (item: unknown) => Record<string, unknown>;
}

export class ApiDataSource implements KnowledgeSource {
  private options: ApiDataSourceOptions;

  constructor(
    private url: string,
    options: ApiDataSourceOptions = {}
  ) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      chunkOverlap: options.chunkOverlap ?? 200,
      minChunkSize: options.minChunkSize ?? 100,
      namespace: options.namespace ?? 'api',
      metadata: options.metadata ?? {},
      headers: options.headers ?? {},
      method: options.method ?? 'GET',
      timeoutMs: options.timeoutMs ?? 30000,
      pagination: options.pagination,
      dataPath: options.dataPath ?? '',
      contentExtractor: options.contentExtractor ?? this.defaultContentExtractor,
      metadataExtractor: options.metadataExtractor ?? this.defaultMetadataExtractor,
    };
  }

  async *load(): AsyncIterable<Chunk> {
    const items = await this.fetchData();

    for (const item of items) {
      try {
        const chunks = this.chunkItem(item);

        for (const chunk of chunks) {
          yield chunk;
        }
      } catch (error) {
        throw new IngestionError(`Failed to process API item: ${(error as Error).message}`, this.url);
      }
    }
  }

  private async fetchData(): Promise<unknown[]> {
    const allItems: unknown[] = [];
    let page = this.options.pagination?.start ?? 0;
    const maxPages = this.options.pagination?.maxPages ?? 1;

    while (page < maxPages) {
      const pageUrl = this.buildUrl(page);
      const items = await this.fetchPage(pageUrl);

      if (items.length === 0) {
        break; // No more data
      }

      allItems.push(...items);
      page++;

      if (!this.options.pagination) {
        break; // No pagination configured
      }
    }

    return allItems;
  }

  private buildUrl(page: number): string {
    if (!this.options.pagination) {
      return this.url;
    }

    const url = new URL(this.url);
    url.searchParams.set(this.options.pagination.param, page.toString());
    return url.href;
  }

  private async fetchPage(url: string): Promise<unknown[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: this.options.method,
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers,
        },
        body: this.options.body ? JSON.stringify(this.options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return this.extractItems(data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractItems(data: unknown): unknown[] {
    if (!this.options.dataPath) {
      return Array.isArray(data) ? data : [data];
    }

    const path = this.options.dataPath.split('.');
    let current: unknown = data;

    for (const key of path) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        throw new Error(`Data path '${this.options.dataPath}' not found in response`);
      }
    }

    return Array.isArray(current) ? current : [current];
  }

  private chunkItem(item: unknown): Chunk[] {
    const content = this.options.contentExtractor!(item);
    const itemMetadata = this.options.metadataExtractor!(item);

    const tokens = estimateTokens(content);

    let itemChunks: string[];
    if (tokens > (this.options.maxChunkSize ?? 2000)) {
      itemChunks = splitLargeChunk(content, this.options.maxChunkSize ?? 2000);
    } else {
      itemChunks = [content];
    }

    if ((this.options.chunkOverlap ?? 200) > 0 && itemChunks.length > 1) {
      itemChunks = applyOverlap(itemChunks, this.options.chunkOverlap ?? 200);
    }

    const chunks: Chunk[] = [];

    for (let i = 0; i < itemChunks.length; i++) {
      const chunkContent = itemChunks[i];
      const chunkId = this.generateChunkId(item, chunkContent, i);

      chunks.push({
        id: chunkId,
        content: chunkContent,
        metadata: {
          ...this.options.metadata,
          ...itemMetadata,
          source: 'api',
          apiUrl: this.url,
          chunkIndex: i,
          totalChunks: itemChunks.length,
        },
      });
    }

    return chunks;
  }

  private defaultContentExtractor(item: unknown): string {
    if (typeof item === 'string') {
      return item;
    }

    if (typeof item === 'object' && item !== null) {
      // Try common content fields
      const contentFields = ['content', 'text', 'description', 'body', 'message'];

      for (const field of contentFields) {
        if (field in item && typeof (item as Record<string, unknown>)[field] === 'string') {
          return (item as Record<string, unknown>)[field] as string;
        }
      }

      // Fallback to JSON string
      return JSON.stringify(item);
    }

    return String(item);
  }

  private defaultMetadataExtractor(item: unknown): Record<string, unknown> {
    if (typeof item === 'object' && item !== null) {
      const metadata: Record<string, unknown> = {};

      // Extract common metadata fields
      const metadataFields = ['id', 'title', 'name', 'created_at', 'updated_at', 'author', 'tags'];

      for (const field of metadataFields) {
        if (field in item) {
          metadata[field] = (item as Record<string, unknown>)[field];
        }
      }

      return metadata;
    }

    return {};
  }

  private generateChunkId(item: unknown, content: string, index: number): string {
    const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
    const itemHash = crypto.createHash('md5').update(JSON.stringify(item)).digest('hex').substring(0, 8);
    return `${this.options.namespace}:${itemHash}:${index}:${hash}`;
  }
}