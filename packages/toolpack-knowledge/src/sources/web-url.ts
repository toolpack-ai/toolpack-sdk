import * as crypto from 'crypto';
import * as cheerio from 'cheerio';
import { KnowledgeSource, Chunk } from '../interfaces.js';
import { IngestionError } from '../errors.js';
import { estimateTokens, splitLargeChunk, applyOverlap } from '../utils/chunking.js';

export interface WebUrlSourceOptions {
  maxChunkSize?: number;
  chunkOverlap?: number;
  minChunkSize?: number;
  namespace?: string;
  metadata?: Record<string, unknown>;
  maxDepth?: number;
  userAgent?: string;
  delayMs?: number;
  timeoutMs?: number;
  sameDomainOnly?: boolean;
  maxPagesPerDomain?: number;
}

interface CrawledPage {
  url: string;
  title: string;
  content: string;
  links: string[];
}

export class WebUrlSource implements KnowledgeSource {
  private options: Required<WebUrlSourceOptions>;
  private crawledUrls = new Set<string>();
  private domainPageCount = new Map<string, number>();
  private lastRequestTime = new Map<string, number>();

  constructor(
    private urls: string[],
    options: WebUrlSourceOptions = {}
  ) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      chunkOverlap: options.chunkOverlap ?? 200,
      minChunkSize: options.minChunkSize ?? 100,
      namespace: options.namespace ?? 'web',
      metadata: options.metadata ?? {},
      maxDepth: options.maxDepth ?? 1,
      userAgent: options.userAgent ?? 'Toolpack-Knowledge/1.0',
      delayMs: options.delayMs ?? 1000,
      timeoutMs: options.timeoutMs ?? 30000,
      sameDomainOnly: options.sameDomainOnly ?? true,
      maxPagesPerDomain: options.maxPagesPerDomain ?? 10,
    };
  }

  async *load(): AsyncIterable<Chunk> {
    const pages = await this.crawlUrls(this.urls, 0);

    for (const page of pages) {
      try {
        const chunks = this.chunkPage(page);

        for (const chunk of chunks) {
          yield chunk;
        }
      } catch (error) {
        throw new IngestionError(`Failed to process URL ${page.url}: ${(error as Error).message}`, page.url);
      }
    }
  }

  private async crawlUrls(urls: string[], depth: number): Promise<CrawledPage[]> {
    if (depth >= this.options.maxDepth) {
      return [];
    }

    const pages: CrawledPage[] = [];
    const newUrls: string[] = [];
    const initialDomains = new Set(urls.map(url => new URL(url).hostname));

    for (const url of urls) {
      if (this.crawledUrls.has(url)) {
        continue;
      }

      const domain = new URL(url).hostname;
      const pageCount = this.domainPageCount.get(domain) ?? 0;

      if (this.options.sameDomainOnly && !initialDomains.has(domain)) {
        continue; // Skip external domains
      }

      if (pageCount >= this.options.maxPagesPerDomain) {
        continue; // Skip if too many pages from this domain
      }

      this.crawledUrls.add(url);
      this.domainPageCount.set(domain, pageCount + 1);

      try {
        // Rate limiting per domain
        const lastTime = this.lastRequestTime.get(domain) ?? 0;
        const timeSince = Date.now() - lastTime;
        if (timeSince < this.options.delayMs) {
          await new Promise(resolve => setTimeout(resolve, this.options.delayMs - timeSince));
        }

        const page = await this.fetchPage(url);
        pages.push(page);
        this.lastRequestTime.set(domain, Date.now());

        if (depth < this.options.maxDepth - 1) {
          newUrls.push(...page.links);
        }
      } catch (error) {
        console.warn(`Failed to crawl ${url}: ${(error as Error).message}`);
      }
    }

    if (newUrls.length > 0) {
      const subPages = await this.crawlUrls(newUrls, depth + 1);
      pages.push(...subPages);
    }

    return pages;
  }

  private async fetchPage(url: string): Promise<CrawledPage> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.options.userAgent,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove script and style elements
      $('script, style, nav, header, footer, aside').remove();

      // Extract title
      const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';

      // Extract main content
      const contentSelectors = ['main', 'article', '.content', '#content', 'body'];
      let content = '';

      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          content = element.text().trim();
          break;
        }
      }

      if (!content) {
        content = $('body').text().trim();
      }

      // Clean up whitespace
      content = content.replace(/\s+/g, ' ').trim();

      // Extract links
      const links: string[] = [];
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, url).href;
            if (absoluteUrl.startsWith('http') && !absoluteUrl.includes('#')) {
              links.push(absoluteUrl);
            }
          } catch {
            // Invalid URL, skip
          }
        }
      });

      return {
        url,
        title,
        content,
        links: [...new Set(links)], // Remove duplicates
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private chunkPage(page: CrawledPage): Chunk[] {
    const chunks: Chunk[] = [];
    const tokens = estimateTokens(page.content);

    let pageChunks: string[];
    if (tokens > this.options.maxChunkSize) {
      pageChunks = splitLargeChunk(page.content, this.options.maxChunkSize);
    } else {
      pageChunks = [page.content];
    }

    if (this.options.chunkOverlap > 0 && pageChunks.length > 1) {
      pageChunks = applyOverlap(pageChunks, this.options.chunkOverlap);
    }

    for (let i = 0; i < pageChunks.length; i++) {
      const chunkContent = pageChunks[i];
      const chunkId = this.generateChunkId(page.url, chunkContent, i);

      chunks.push({
        id: chunkId,
        content: chunkContent,
        metadata: {
          ...this.options.metadata,
          title: page.title,
          url: page.url,
          source: 'web',
          chunkIndex: i,
          totalChunks: pageChunks.length,
        },
      });
    }

    return chunks;
  }

  private generateChunkId(url: string, content: string, index: number): string {
    const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
    const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
    return `${this.options.namespace}:${urlHash}:${index}:${hash}`;
  }
}