import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownSource } from '../sources/markdown.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('MarkdownSource', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tk-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string): Promise<void> {
    await fs.writeFile(path.join(tmpDir, name), content, 'utf-8');
  }

  async function collectChunks(source: MarkdownSource) {
    const chunks = [];
    for await (const chunk of source.load()) {
      chunks.push(chunk);
    }
    return chunks;
  }

  describe('basic chunking', () => {
    it('should chunk by headings', async () => {
      await writeFile('test.md', `# Title

Intro paragraph.

## Section A

Content for section A.

## Section B

Content for section B.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'), { minChunkSize: 1 });
      const chunks = await collectChunks(source);

      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should include heading text in chunk content', async () => {
      await writeFile('test.md', `# Title

Intro text.

## Installation

Install the package using npm.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'));
      const chunks = await collectChunks(source);

      const installChunk = chunks.find(c =>
        c.content.includes('Installation') && c.content.includes('Install the package')
      );
      expect(installChunk).toBeDefined();
    });

    it('should set heading path in metadata', async () => {
      await writeFile('test.md', `# Getting Started

## Installation

Install steps here.

## Configuration

Config steps here.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'), { minChunkSize: 1 });
      const chunks = await collectChunks(source);

      const configChunk = chunks.find(c => c.content.includes('Config steps'));
      expect(configChunk).toBeDefined();
      expect(configChunk!.metadata.heading).toContain('Configuration');
    });
  });

  describe('frontmatter', () => {
    it('should extract YAML frontmatter as metadata', async () => {
      await writeFile('test.md', `---
title: Test Doc
category: guide
draft: false
order: 3
tags: [setup, npm]
---

# Test Doc

Some content here.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'));
      const chunks = await collectChunks(source);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.title).toBe('Test Doc');
      expect(chunks[0].metadata.category).toBe('guide');
      expect(chunks[0].metadata.draft).toBe(false);
      expect(chunks[0].metadata.order).toBe(3);
      expect(chunks[0].metadata.tags).toEqual(['setup', 'npm']);
    });

    it('should not include frontmatter in chunk content', async () => {
      await writeFile('test.md', `---
title: Test
---

# Heading

Body content.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'));
      const chunks = await collectChunks(source);

      for (const chunk of chunks) {
        expect(chunk.content).not.toContain('---');
        expect(chunk.content).not.toContain('title: Test');
      }
    });
  });

  describe('code detection', () => {
    it('should set hasCode true for chunks with code blocks', async () => {
      await writeFile('test.md', `# API

## Usage

Here is how to use:

\`\`\`typescript
const x = 1;
\`\`\`

## Overview

No code here, just text.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'), { minChunkSize: 1 });
      const chunks = await collectChunks(source);

      const usageChunk = chunks.find(c => c.content.includes('const x = 1'));
      const overviewChunk = chunks.find(c => c.content.includes('No code here'));

      expect(usageChunk).toBeDefined();
      expect(usageChunk!.metadata.hasCode).toBe(true);

      expect(overviewChunk).toBeDefined();
      expect(overviewChunk!.metadata.hasCode).toBe(false);
    });
  });

  describe('chunk IDs', () => {
    it('should generate deterministic IDs based on content', async () => {
      await writeFile('test.md', `# Title

Content here.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'), { namespace: 'docs' });
      const chunks1 = await collectChunks(source);
      const chunks2 = await collectChunks(source);

      expect(chunks1.length).toBe(chunks2.length);
      for (let i = 0; i < chunks1.length; i++) {
        expect(chunks1[i].id).toBe(chunks2[i].id);
      }
    });

    it('should prefix IDs with namespace', async () => {
      await writeFile('test.md', `# Title

Content.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'), { namespace: 'myns' });
      const chunks = await collectChunks(source);

      expect(chunks[0].id.startsWith('myns:')).toBe(true);
    });
  });

  describe('source-level metadata', () => {
    it('should merge source-level metadata into every chunk', async () => {
      await writeFile('test.md', `# Title

Content A.

## Section

Content B.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'), {
        metadata: { type: 'documentation', version: 2 },
      });
      const chunks = await collectChunks(source);

      for (const chunk of chunks) {
        expect(chunk.metadata.type).toBe('documentation');
        expect(chunk.metadata.version).toBe(2);
      }
    });
  });

  describe('minChunkSize merge', () => {
    it('should merge small sections into the previous chunk', async () => {
      await writeFile('test.md', `# Title

A very long paragraph with enough content to exceed the minimum chunk size threshold so it stands as its own chunk rather than being merged. Adding more text here to make absolutely sure.

## Tiny

Hi.
`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'), {
        minChunkSize: 50,
      });
      const chunks = await collectChunks(source);

      const tinyStandalone = chunks.find(
        c => c.content.trim() === '## Tiny\nHi.' || c.content.trim() === 'Hi.'
      );
      expect(tinyStandalone).toBeUndefined();
    });
  });

  describe('multiple files', () => {
    it('should process all matching files', async () => {
      await writeFile('a.md', `# File A\n\nContent A.`);
      await writeFile('b.md', `# File B\n\nContent B.`);
      await writeFile('c.txt', `Not markdown`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'));
      const chunks = await collectChunks(source);

      const sources = chunks.map(c => c.metadata.source);
      expect(sources).toContain('a.md');
      expect(sources).toContain('b.md');
      expect(sources).not.toContain('c.txt');
    });
  });

  describe('empty / edge cases', () => {
    it('should handle empty files gracefully', async () => {
      await writeFile('empty.md', '');

      const source = new MarkdownSource(path.join(tmpDir, '*.md'));
      const chunks = await collectChunks(source);

      expect(chunks.length).toBe(0);
    });

    it('should handle files with no headings', async () => {
      await writeFile('noheadings.md', `Just plain text.\n\nAnother paragraph.`);

      const source = new MarkdownSource(path.join(tmpDir, '*.md'));
      const chunks = await collectChunks(source);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('Just plain text');
    });

    it('should handle no matching files without error', async () => {
      const source = new MarkdownSource(path.join(tmpDir, '*.md'));
      const chunks = await collectChunks(source);

      expect(chunks.length).toBe(0);
    });
  });
});
