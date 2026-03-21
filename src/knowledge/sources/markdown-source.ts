import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fg from 'fast-glob';
import type { KnowledgeSource, Chunk, ChunkUpdate, MarkdownSourceOptions } from '../types.js';
import { IngestionError } from '../errors.js';

const DEFAULT_MAX_CHUNK_SIZE = 2000;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_MIN_CHUNK_SIZE = 100;

type FrontmatterValue = string | number | boolean | string[];
type Frontmatter = Record<string, FrontmatterValue>;

interface ParsedSection {
  headings: string[];
  content: string;
  hasCode: boolean;
  frontmatter: Frontmatter;
}

export class MarkdownSource implements KnowledgeSource {
  private pattern: string;
  private options: MarkdownSourceOptions;
  private watcher: fs.FSWatcher | null = null;
  private fileHashes: Map<string, string> = new Map();

  constructor(pattern: string, options: MarkdownSourceOptions = {}) {
    // Auto-append **/*.md if pattern looks like a directory (no glob chars and no .md extension)
    if (!pattern.includes('*') && !pattern.includes('?') && !pattern.endsWith('.md')) {
      this.pattern = pattern.endsWith('/') ? `${pattern}**/*.md` : `${pattern}/**/*.md`;
    } else {
      this.pattern = pattern;
    }
    this.options = {
      maxChunkSize: DEFAULT_MAX_CHUNK_SIZE,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
      minChunkSize: DEFAULT_MIN_CHUNK_SIZE,
      ...options,
    };
  }

  async *load(): AsyncIterable<Chunk> {
    const files = await fg(this.pattern, { absolute: true });

    for (const filePath of files) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const hash = this.hashContent(content);
        this.fileHashes.set(filePath, hash);

        const chunks = this.parseMarkdown(filePath, content);
        for (const chunk of chunks) {
          yield chunk;
        }
      } catch (error) {
        throw new IngestionError(
          `Failed to parse markdown file: ${(error as Error).message}`,
          filePath,
          error as Error
        );
      }
    }
  }

  async *watch(): AsyncIterable<ChunkUpdate> {
    if (!this.options.watch) {
      return;
    }

    const baseDir = this.getBaseDir();
    const updateQueue: ChunkUpdate[] = [];
    let resolveNext: ((value: IteratorResult<ChunkUpdate>) => void) | null = null;

    const processFile = async (filePath: string, eventType: 'add' | 'change' | 'unlink') => {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
      
      if (!this.matchesPattern(absolutePath)) {
        return;
      }

      if (eventType === 'unlink') {
        const oldHash = this.fileHashes.get(absolutePath);
        if (oldHash) {
          this.fileHashes.delete(absolutePath);
          const chunkId = this.generateChunkId(absolutePath, '', 0);
          updateQueue.push({
            type: 'delete',
            chunk: { id: chunkId, content: '', metadata: { source: absolutePath } },
          });
        }
      } else {
        try {
          const content = await fs.promises.readFile(absolutePath, 'utf-8');
          const newHash = this.hashContent(content);
          const oldHash = this.fileHashes.get(absolutePath);

          if (oldHash !== newHash) {
            this.fileHashes.set(absolutePath, newHash);
            const chunks = this.parseMarkdown(absolutePath, content);
            
            const updateType = oldHash ? 'update' : 'add';
            for (const chunk of chunks) {
              updateQueue.push({ type: updateType, chunk });
            }
          }
        } catch {
          // File might have been deleted between event and read
        }
      }

      if (resolveNext && updateQueue.length > 0) {
        const update = updateQueue.shift()!;
        const resolve = resolveNext;
        resolveNext = null;
        resolve({ value: update, done: false });
      }
    };

    this.watcher = fs.watch(baseDir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        const fullPath = path.join(baseDir, filename);
        if (eventType === 'rename') {
          fs.access(fullPath, fs.constants.F_OK, (err) => {
            processFile(fullPath, err ? 'unlink' : 'add');
          });
        } else {
          processFile(fullPath, 'change');
        }
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

  private parseMarkdown(filePath: string, content: string): Chunk[] {
    const { frontmatter, body } = this.extractFrontmatter(content);
    const sections = this.splitByHeadings(body);
    const chunks: Chunk[] = [];

    let chunkIndex = 0;
    const relativePath = this.getRelativePath(filePath);

    for (const section of sections) {
      const sectionChunks = this.splitLargeSection(section);
      const totalChunks = sectionChunks.length;

      for (const sectionChunk of sectionChunks) {
        const id = this.generateChunkId(filePath, sectionChunk.content, chunkIndex);
        
        chunks.push({
          id,
          content: sectionChunk.content,
          metadata: {
            ...frontmatter,
            ...(this.options.metadata ?? {}),
            heading: sectionChunk.headings,
            hasCode: sectionChunk.hasCode,
            source: relativePath,
            chunkIndex,
            totalChunks,
            ...(this.extractTags(sectionChunk.content)),
            ...(this.extractWikilinks(sectionChunk.content)),
          },
        });
        chunkIndex++;
      }
    }

    return chunks;
  }

  private extractFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    
    if (!frontmatterMatch) {
      return { frontmatter: {}, body: content };
    }

    const frontmatterStr = frontmatterMatch[1];
    const body = content.slice(frontmatterMatch[0].length);
    const frontmatter: Frontmatter = {};

    for (const line of frontmatterStr.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const rawValue = line.slice(colonIndex + 1).trim();
        const parsedValue = this.parseFrontmatterValue(rawValue);
        frontmatter[key] = parsedValue;
      }
    }

    return { frontmatter, body };
  }

  private splitByHeadings(content: string): ParsedSection[] {
    const lines = content.split('\n');
    const sections: ParsedSection[] = [];
    let currentHeadings: string[] = [];
    let currentContent: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        currentContent.push(line);
        continue;
      }

      if (!inCodeBlock && line.match(/^#{1,6}\s/)) {
        if (currentContent.length > 0) {
          const contentStr = currentContent.join('\n').trim();
          if (contentStr) {
            sections.push({
              headings: [...currentHeadings],
              content: contentStr,
              hasCode: currentContent.some((l) => l.startsWith('```')),
              frontmatter: {},
            });
          }
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingText = headingMatch[2].trim();
          
          currentHeadings = currentHeadings.slice(0, level - 1);
          currentHeadings[level - 1] = headingText;
          currentHeadings = currentHeadings.filter(Boolean);
        }
        
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      const contentStr = currentContent.join('\n').trim();
      if (contentStr) {
        sections.push({
          headings: [...currentHeadings],
          content: contentStr,
          hasCode: currentContent.some((l) => l.startsWith('```')),
          frontmatter: {},
        });
      }
    }

    if (sections.length === 0 && content.trim()) {
      sections.push({
        headings: [],
        content: content.trim(),
        hasCode: content.includes('```'),
        frontmatter: {},
      });
    }

    return sections;
  }

  private splitLargeSection(section: ParsedSection): ParsedSection[] {
    const maxSize = this.options.maxChunkSize!;
    const minSize = this.options.minChunkSize!;
    const overlap = this.options.chunkOverlap!;

    const tokens = this.estimateTokens(section.content);
    
    if (tokens <= maxSize) {
      return [section];
    }

    const paragraphs = section.content.split(/\n\n+/);
    const chunks: ParsedSection[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);

      if (currentTokens + paragraphTokens > maxSize && currentChunk.length > 0) {
        chunks.push({
          ...section,
          content: currentChunk.join('\n\n'),
        });

        const overlapText = this.getOverlapText(currentChunk, overlap);
        currentChunk = overlapText ? [overlapText] : [];
        currentTokens = this.estimateTokens(currentChunk.join('\n\n'));
      }

      if (paragraphTokens > maxSize) {
        const sentences = this.splitIntoSentences(paragraph);
        for (const sentence of sentences) {
          const sentenceTokens = this.estimateTokens(sentence);
          
          if (currentTokens + sentenceTokens > maxSize && currentChunk.length > 0) {
            chunks.push({
              ...section,
              content: currentChunk.join(' '),
            });
            currentChunk = [];
            currentTokens = 0;
          }
          
          currentChunk.push(sentence);
          currentTokens += sentenceTokens;
        }
      } else {
        currentChunk.push(paragraph);
        currentTokens += paragraphTokens;
      }
    }

    if (currentChunk.length > 0) {
      const content = currentChunk.join('\n\n');
      if (this.estimateTokens(content) >= minSize || chunks.length === 0) {
        chunks.push({
          ...section,
          content,
        });
      } else if (chunks.length > 0) {
        const lastChunk = chunks[chunks.length - 1];
        lastChunk.content += '\n\n' + content;
      }
    }

    return chunks;
  }

  private getOverlapText(chunks: string[], targetTokens: number): string {
    const result: string[] = [];
    let tokens = 0;

    for (let i = chunks.length - 1; i >= 0 && tokens < targetTokens; i--) {
      const chunkTokens = this.estimateTokens(chunks[i]);
      if (tokens + chunkTokens <= targetTokens) {
        result.unshift(chunks[i]);
        tokens += chunkTokens;
      } else {
        break;
      }
    }

    return result.join('\n\n');
  }

  private splitIntoSentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/).filter(Boolean);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private extractTags(content: string): { tags?: string[] } {
    const tagMatches = content.match(/#[\w-]+/g);
    if (tagMatches) {
      return { tags: [...new Set(tagMatches.map((t) => t.slice(1)))] };
    }
    return {};
  }

  private extractWikilinks(content: string): { links?: string[] } {
    const linkMatches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
    if (linkMatches) {
      const links = linkMatches.map((l) => {
        const match = l.match(/\[\[([^\]|]+)/);
        return match ? match[1] : '';
      }).filter(Boolean);
      return { links: [...new Set(links)] };
    }
    return {};
  }

  private generateChunkId(filePath: string, content: string, index: number): string {
    const namespace = this.options.namespace ?? 'default';
    const relativePath = this.getRelativePath(filePath);
    const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
    return `${namespace}:${relativePath}:${hash}:${index}`;
  }

  private getRelativePath(filePath: string): string {
    const baseDir = this.getBaseDir();
    return path.relative(baseDir, filePath);
  }

  private getBaseDir(): string {
    const patternParts = this.pattern.split(/[*?]/);
    return patternParts[0].replace(/\/$/, '') || '.';
  }

  private matchesPattern(filePath: string): boolean {
    return filePath.endsWith('.md');
  }

  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private parseFrontmatterValue(value: string): FrontmatterValue {
    if (value.startsWith('[') && value.endsWith(']')) {
      return value
        .slice(1, -1)
        .split(',')
        .map((segment) => segment.trim().replace(/^["']|["']$/g, ''));
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    if (!Number.isNaN(Number(value)) && value !== '') {
      return Number(value);
    }

    return value.replace(/^["']|["']$/g, '');
  }
}
