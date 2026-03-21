import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { KnowledgeSource, Chunk, ChunkUpdate, JSONSourceOptions } from '../types.js';
import { IngestionError } from '../errors.js';

export class JSONSource implements KnowledgeSource {
  private filePath: string;
  private options: JSONSourceOptions;
  private watcher: fs.FSWatcher | null = null;
  private lastHash: string | null = null;

  constructor(filePath: string, options: JSONSourceOptions = {}) {
    this.filePath = path.resolve(filePath);
    this.options = options;
  }

  async *load(): AsyncIterable<Chunk> {
    try {
      const content = await fs.promises.readFile(this.filePath, 'utf-8');
      this.lastHash = this.hashContent(content);
      const data = JSON.parse(content);

      const chunks = this.extractChunks(data);
      for (const chunk of chunks) {
        yield chunk;
      }
    } catch (error) {
      throw new IngestionError(
        `Failed to parse JSON file: ${(error as Error).message}`,
        this.filePath,
        error as Error
      );
    }
  }

  async *watch(): AsyncIterable<ChunkUpdate> {
    if (!this.options.watch) {
      return;
    }

    const updateQueue: ChunkUpdate[] = [];
    let resolveNext: ((value: IteratorResult<ChunkUpdate>) => void) | null = null;

    const processChange = async () => {
      try {
        const content = await fs.promises.readFile(this.filePath, 'utf-8');
        const newHash = this.hashContent(content);

        if (newHash !== this.lastHash) {
          this.lastHash = newHash;
          const data = JSON.parse(content);
          const chunks = this.extractChunks(data);

          for (const chunk of chunks) {
            updateQueue.push({ type: 'update', chunk });
          }

          if (resolveNext && updateQueue.length > 0) {
            const update = updateQueue.shift()!;
            const resolve = resolveNext;
            resolveNext = null;
            resolve({ value: update, done: false });
          }
        }
      } catch {
        // File might be in the middle of being written
      }
    };

    this.watcher = fs.watch(this.filePath, (eventType) => {
      if (eventType === 'change') {
        processChange();
      }
    });

    while (true) {
      if (updateQueue.length > 0) {
        yield updateQueue.shift()!;
      } else {
        yield await new Promise<ChunkUpdate>((resolve) => {
          resolveNext = (result) => resolve(result.value);
        });
      }
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private extractChunks(data: any): Chunk[] {
    const chunkBy = this.options.chunkBy ?? 'item';
    const contentFields = this.options.contentFields ?? [];
    const metadataFields = this.options.metadataFields ?? [];

    let items: any[];

    if (chunkBy === 'item') {
      items = Array.isArray(data) ? data : [data];
    } else if (chunkBy.startsWith('$.')) {
      items = this.evaluateJSONPath(data, chunkBy);
    } else {
      items = Array.isArray(data) ? data : [data];
    }

    return items.map((item, index) => this.itemToChunk(item, index, contentFields, metadataFields));
  }

  private evaluateJSONPath(data: any, pathExpr: string): any[] {
    const path = pathExpr.slice(2);
    const segments = path.split(/(?=\[)|\./).filter(Boolean);
    
    let current: any[] = [data];

    for (const segment of segments) {
      const next: any[] = [];
      
      for (const item of current) {
        if (segment === '[*]') {
          if (Array.isArray(item)) {
            next.push(...item);
          } else if (typeof item === 'object' && item !== null) {
            next.push(...Object.values(item));
          }
        } else {
          const key = segment.replace(/^\[|\]$/g, '');
          if (item && typeof item === 'object' && key in item) {
            next.push(item[key]);
          }
        }
      }
      
      current = next;
    }

    return current;
  }

  private itemToChunk(
    item: any,
    index: number,
    contentFields: string[],
    metadataFields: string[]
  ): Chunk {
    let content: string;

    if (contentFields.length > 0) {
      const contentParts = contentFields
        .map((field) => this.getNestedValue(item, field))
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v));
      content = contentParts.join('\n\n');
    } else {
      content = this.flattenToContent(item);
    }

    const metadata: Record<string, any> = {
      ...(this.options.metadata ?? {}),
      source: this.filePath,
      index,
    };

    if (metadataFields.length > 0) {
      for (const field of metadataFields) {
        const value = this.getNestedValue(item, field);
        if (value !== undefined) {
          metadata[field] = value;
        }
      }
    }

    const namespace = this.options.namespace ?? 'json';
    const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
    const id = `${namespace}:${path.basename(this.filePath)}:${hash}:${index}`;

    return { id, content, metadata };
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  private flattenToContent(obj: any, prefix: string = ''): string {
    if (obj === null || obj === undefined) {
      return '';
    }

    if (typeof obj !== 'object') {
      return prefix ? `${prefix}: ${obj}` : String(obj);
    }

    if (Array.isArray(obj)) {
      return obj
        .map((item, i) => this.flattenToContent(item, prefix ? `${prefix}[${i}]` : `[${i}]`))
        .filter(Boolean)
        .join('\n');
    }

    return Object.entries(obj)
      .map(([key, value]) => {
        const newPrefix = prefix ? `${prefix}.${key}` : key;
        return this.flattenToContent(value, newPrefix);
      })
      .filter(Boolean)
      .join('\n');
  }

  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }
}
