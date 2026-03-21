import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { Knowledge } from '../../../src/knowledge/knowledge.js';
import { MemoryProvider } from '../../../src/knowledge/providers/memory-provider.js';
import { MarkdownSource } from '../../../src/knowledge/sources/markdown-source.js';
import { JSONSource } from '../../../src/knowledge/sources/json-source.js';
import { SQLiteTextSource } from '../../../src/knowledge/sources/sqlite-text-source.js';
import type { Embedder } from '../../../src/knowledge/types.js';

class DeterministicEmbedder implements Embedder {
  dimensions = 3;

  async embed(text: string): Promise<number[]> {
    const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return [Math.sin(hash), Math.cos(hash), Math.tan(hash % 1.2)];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

describe('Knowledge integration with sources', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'knowledge-intg-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('indexes and queries Markdown sources end-to-end', async () => {
    const docsDir = path.join(tempDir, 'docs');
    await fs.promises.mkdir(docsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(docsDir, 'setup.md'),
      `# Installation\n\nInstall via npm install toolpack-sdk.\n\n# Usage\n\nUse Toolpack SDK in your project.\n`
    );

    const provider = new MemoryProvider();
    const kb = await Knowledge.create({
      provider,
      source: new MarkdownSource(path.join(docsDir, '*.md')),
      embedder: new DeterministicEmbedder(),
    });

    const results = await kb.query('How do I install?', { threshold: 0 });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.chunk.content.includes('Install via npm'))).toBe(true);

    await kb.stop();
  });

  it('indexes and queries JSON sources end-to-end', async () => {
    const filePath = path.join(tempDir, 'faq.json');
    const data = [
      { id: 'reset', question: 'How do I reset my password?', answer: 'Go to settings', category: 'auth' },
      { id: 'billing', question: 'How is billing handled?', answer: 'Monthly invoice', category: 'billing' },
    ];
    await fs.promises.writeFile(filePath, JSON.stringify(data));

    const provider = new MemoryProvider();
    const kb = await Knowledge.create({
      provider,
      source: new JSONSource(filePath, {
        chunkBy: 'item',
        contentFields: ['question', 'answer'],
        metadataFields: ['category'],
      }),
      embedder: new DeterministicEmbedder(),
    });

    const results = await kb.query('reset password', {
      filter: { category: 'auth' },
      threshold: 0,
    });

    expect(results.length).toBe(1);
    expect(results[0].chunk.content).toContain('reset my password');

    await kb.stop();
  });

  it('indexes and queries SQLite sources end-to-end', async () => {
    const dbPath = path.join(tempDir, 'articles.db');
    const db = new Database(dbPath);
    db.prepare(
      `CREATE TABLE articles (
        id TEXT PRIMARY KEY,
        title TEXT,
        body TEXT,
        category TEXT
      )`
    ).run();
    const insert = db.prepare('INSERT INTO articles (id, title, body, category) VALUES (?, ?, ?, ?)');
    insert.run('pricing', 'Pricing Guide', 'Pricing is calculated per seat.', 'docs');
    insert.run('limits', 'Rate Limits', 'API rate limits are enforced hourly.', 'docs');
    db.close();

    const provider = new MemoryProvider();
    const kb = await Knowledge.create({
      provider,
      source: new SQLiteTextSource(dbPath, {
        table: 'articles',
        contentColumns: ['title', 'body'],
        metadataColumns: ['category'],
      }),
      embedder: new DeterministicEmbedder(),
    });

    const results = await kb.query('pricing per seat', { threshold: 0 });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.chunk.content.includes('Pricing'))).toBe(true);
    expect(results[0].chunk.metadata.category).toBe('docs');

    await kb.stop();
  });
});
