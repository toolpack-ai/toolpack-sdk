import * as crypto from 'crypto';
import { KnowledgeSource, Chunk } from '../interfaces.js';
import { estimateTokens, splitLargeChunk, applyOverlap } from '../utils/chunking.js';

export interface TextSourceOptions {
  maxChunkSize?: number;
  chunkOverlap?: number;
  namespace?: string;
  metadata?: Record<string, unknown>;
}

export class TextSource implements KnowledgeSource {
  private options: Required<TextSourceOptions>;

  constructor(
    private name: string,
    private content: string,
    options: TextSourceOptions = {}
  ) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      chunkOverlap: options.chunkOverlap ?? 200,
      namespace: options.namespace ?? 'text',
      metadata: options.metadata ?? {},
    };
  }

  async *load(): AsyncIterable<Chunk> {
    const chunks = this.chunkText(this.content);
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  private chunkText(content: string): Chunk[] {
    if (!content.trim()) return [];

    let parts: string[];

    if (estimateTokens(content) <= this.options.maxChunkSize) {
      parts = [content];
    } else {
      parts = splitLargeChunk(content, this.options.maxChunkSize);
    }

    if (this.options.chunkOverlap > 0 && parts.length > 1) {
      parts = applyOverlap(parts, this.options.chunkOverlap);
    }

    return parts.map((part, index) => ({
      id: this.chunkId(part, index),
      content: part,
      metadata: {
        ...this.options.metadata,
        source: this.name,
        chunkIndex: index,
        totalChunks: parts.length,
      },
    }));
  }

  private chunkId(content: string, index: number): string {
    const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
    return `${this.options.namespace}:${this.name}:${index}:${hash}`;
  }
}
