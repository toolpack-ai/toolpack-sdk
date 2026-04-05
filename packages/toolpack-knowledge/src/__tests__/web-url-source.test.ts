import { describe, it, expect, vi } from 'vitest';
import { WebUrlSource } from '../../dist/index.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('WebUrlSource', () => {
  it('should crawl and chunk web pages', async () => {
    const mockHtml = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Main Title</h1>
          <p>This is some content from a web page.</p>
          <p>This is more content that should be extracted.</p>
          <a href="/internal">Internal Link</a>
          <a href="https://external.com">External Link</a>
        </body>
      </html>
    `;

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    });

    const source = new WebUrlSource(['https://example.com'], {
      maxDepth: 1,
      delayMs: 0, // No delay for tests
    });

    const chunks = [];
    for await (const chunk of source.load()) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('Main Title');
    expect(chunks[0].content).toContain('content from a web page');    
    expect(chunks[0].metadata.title).toBe('Test Page');
    expect(chunks[0].metadata.url).toBe('https://example.com');
    expect(chunks[0].metadata.source).toBe('web');
  });

  it('should handle fetch errors gracefully', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    const source = new WebUrlSource(['https://failing-url.com'], {
      delayMs: 0,
    });

    const chunks = [];
    for await (const chunk of source.load()) {
      chunks.push(chunk);
    }

    // Should not throw, just skip the failing URL
    expect(chunks.length).toBe(0);
  });
});