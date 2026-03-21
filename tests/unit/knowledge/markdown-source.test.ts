import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MarkdownSource } from '../../../src/knowledge/sources/markdown-source.js';

describe('MarkdownSource', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'markdown-source-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should load and chunk markdown files', async () => {
      const content = `# Getting Started

This is the intro.

## Installation

Install with npm:

\`\`\`bash
npm install toolpack-sdk
\`\`\`

## Usage

Use it like this.
`;
      await fs.promises.writeFile(path.join(tempDir, 'test.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'));
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.metadata.heading?.includes('Installation'))).toBe(true);
    });

    it('should extract frontmatter as metadata', async () => {
      const content = `---
title: My Document
tags: [setup, guide]
author: John
---

# Content

Some content here.
`;
      await fs.promises.writeFile(path.join(tempDir, 'frontmatter.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'));
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata.title).toBe('My Document');
      expect(chunks[0].metadata.author).toBe('John');
      expect(chunks[0].metadata.tags).toEqual(['setup', 'guide']);
    });

    it('should detect code blocks', async () => {
      const content = `# Code Example

\`\`\`javascript
console.log('hello');
\`\`\`
`;
      await fs.promises.writeFile(path.join(tempDir, 'code.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'));
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks.some((c) => c.metadata.hasCode === true)).toBe(true);
    });

    it('should extract wikilinks', async () => {
      const content = `# Notes

See [[Other Page]] and [[Another|with alias]].
`;
      await fs.promises.writeFile(path.join(tempDir, 'wikilinks.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'));
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata.links).toContain('Other Page');
      expect(chunks[0].metadata.links).toContain('Another');
    });

    it('should extract hashtags', async () => {
      const content = `# Tagged Content

This has #important and #todo tags.
`;
      await fs.promises.writeFile(path.join(tempDir, 'tags.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'));
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata.tags).toContain('important');
      expect(chunks[0].metadata.tags).toContain('todo');
    });

    it('should apply namespace to chunk IDs', async () => {
      const content = `# Test

Content.
`;
      await fs.promises.writeFile(path.join(tempDir, 'namespaced.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'), {
        namespace: 'docs',
      });
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].id.startsWith('docs:')).toBe(true);
    });

    it('should add custom metadata to all chunks', async () => {
      const content = `# Test

Content.
`;
      await fs.promises.writeFile(path.join(tempDir, 'custom.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'), {
        metadata: { type: 'documentation', version: 1 },
      });
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks[0].metadata.type).toBe('documentation');
      expect(chunks[0].metadata.version).toBe(1);
    });

    it('should split large sections', async () => {
      const longParagraph = 'This is a sentence. '.repeat(500);
      const content = `# Large Section

${longParagraph}
`;
      await fs.promises.writeFile(path.join(tempDir, 'large.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'), {
        maxChunkSize: 500,
      });
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('heading hierarchy', () => {
    it('should preserve heading path in metadata', async () => {
      const content = `# Main

## Section A

### Subsection A1

Content in A1.

## Section B

Content in B.
`;
      await fs.promises.writeFile(path.join(tempDir, 'hierarchy.md'), content);

      const source = new MarkdownSource(path.join(tempDir, '*.md'));
      const chunks: any[] = [];

      for await (const chunk of source.load()) {
        chunks.push(chunk);
      }

      const a1Chunk = chunks.find((c) => c.content.includes('Content in A1'));
      expect(a1Chunk?.metadata.heading).toEqual(['Main', 'Section A', 'Subsection A1']);

      const bChunk = chunks.find((c) => c.content.includes('Content in B'));
      expect(bChunk?.metadata.heading).toEqual(['Main', 'Section B']);
    });
  });
});
