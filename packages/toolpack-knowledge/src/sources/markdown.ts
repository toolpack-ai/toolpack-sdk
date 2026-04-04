import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import fg from 'fast-glob';
import { KnowledgeSource, Chunk } from '../interfaces.js';
import { IngestionError } from '../errors.js';
import { estimateTokens, splitLargeChunk, applyOverlap } from '../utils/chunking.js';

export interface MarkdownSourceOptions {
  maxChunkSize?: number;
  chunkOverlap?: number;
  minChunkSize?: number;
  namespace?: string;
  metadata?: Record<string, unknown>;
}

interface Section {
  heading: string[];
  content: string;
  level: number;
}

export class MarkdownSource implements KnowledgeSource {
  private options: Required<MarkdownSourceOptions>;

  constructor(
    private pattern: string,
    options: MarkdownSourceOptions = {}
  ) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      chunkOverlap: options.chunkOverlap ?? 200,
      minChunkSize: options.minChunkSize ?? 100,
      namespace: options.namespace ?? 'markdown',
      metadata: options.metadata ?? {},
    };
  }

  async *load(): AsyncIterable<Chunk> {
    // Convert Windows backslashes to forward slashes for fast-glob compatibility
    const normalizedPattern = this.pattern.replace(/\\/g, '/');
    const files = await fg(normalizedPattern, { absolute: true });
    
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const chunks = this.chunkMarkdown(content, file);
        
        for (const chunk of chunks) {
          yield chunk;
        }
      } catch (error) {
        throw new IngestionError(`Failed to process file: ${(error as Error).message}`, file);
      }
    }
  }

  private chunkMarkdown(content: string, filePath: string): Chunk[] {
    const frontmatter = this.extractFrontmatter(content);
    const contentWithoutFrontmatter = this.removeFrontmatter(content);
    const sections = this.parseHeadings(contentWithoutFrontmatter);
    const chunks: Chunk[] = [];

    let chunkIndex = 0;

    for (const section of sections) {
      const hasCode = /```[\s\S]*?```/.test(section.content);
      const tokens = estimateTokens(section.content);

      if (tokens < this.options.minChunkSize && chunks.length > 0) {
        const lastChunk = chunks[chunks.length - 1];
        lastChunk.content += '\n\n' + section.content;
        if (hasCode) {
          lastChunk.metadata.hasCode = true;
        }
        continue;
      }

      let sectionChunks: string[];
      if (tokens > this.options.maxChunkSize) {
        sectionChunks = splitLargeChunk(section.content, this.options.maxChunkSize);
      } else {
        sectionChunks = [section.content];
      }

      if (this.options.chunkOverlap > 0 && sectionChunks.length > 1) {
        sectionChunks = applyOverlap(sectionChunks, this.options.chunkOverlap);
      }

      for (let i = 0; i < sectionChunks.length; i++) {
        const chunkContent = sectionChunks[i];
        const chunkId = this.generateChunkId(filePath, chunkContent, chunkIndex);

        chunks.push({
          id: chunkId,
          content: chunkContent,
          metadata: {
            ...this.options.metadata,
            ...frontmatter,
            heading: section.heading,
            hasCode,
            source: path.basename(filePath),
            sourcePath: filePath,
            chunkIndex,
            totalChunks: sectionChunks.length,
          },
        });

        chunkIndex++;
      }
    }

    return chunks;
  }

  private parseHeadings(content: string): Section[] {
    const lines = content.split('\n');
    const sections: Section[] = [];
    const headingStack: { level: number; text: string }[] = [];
    let currentContent: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        if (currentContent.length > 0) {
          const headingPath = headingStack.map(h => h.text);
          sections.push({
            heading: headingPath.length > 0 ? [...headingPath] : [''],
            content: currentContent.join('\n').trim(),
            level: headingStack.length > 0 ? headingStack[headingStack.length - 1].level : 0,
          });
          currentContent = [];
        }

        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();

        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }

        headingStack.push({ level, text });
        currentContent.push(line);
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      const headingPath = headingStack.map(h => h.text);
      sections.push({
        heading: headingPath.length > 0 ? [...headingPath] : [''],
        content: currentContent.join('\n').trim(),
        level: headingStack.length > 0 ? headingStack[headingStack.length - 1].level : 0,
      });
    }

    return sections.filter(s => s.content.length > 0);
  }

  private extractFrontmatter(content: string): Record<string, unknown> {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return {};
    }

    const frontmatterText = frontmatterMatch[1];
    const frontmatter: Record<string, unknown> = {};

    const lines = frontmatterText.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const key = match[1];
        let value: unknown = match[2].trim();

        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (!isNaN(Number(value))) value = Number(value);
        else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map((v: string) => v.trim());
        }

        frontmatter[key] = value;
      }
    }

    return frontmatter;
  }

  private removeFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  private generateChunkId(filePath: string, content: string, index: number): string {
    const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
    const filename = path.basename(filePath, path.extname(filePath));
    return `${this.options.namespace}:${filename}:${index}:${hash}`;
  }
}
