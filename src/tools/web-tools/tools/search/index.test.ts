import { describe, it, expect, vi, afterEach } from 'vitest';
import { webSearchTool } from './index.js';

describe('web.search tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(webSearchTool.name).toBe('web.search');
        expect(webSearchTool.category).toBe('network');
    });

    it('should throw if query is missing', async () => {
        await expect(webSearchTool.execute({})).rejects.toThrow('query is required');
    });

    it('should parse search results from DuckDuckGo Lite HTML', async () => {
        const mockHtml = `
            <html><body>
                <a class="result-link" href="https://example.com/1">Result One</a>
                <span class="result-snippet">Snippet for result one</span>
                <a class="result-link" href="https://example.com/2">Result Two</a>
                <span class="result-snippet">Snippet for result two</span>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = JSON.parse(await webSearchTool.execute({ query: 'test' }));
        expect(result).toHaveLength(2);
        expect(result[0].title).toBe('Result One');
        expect(result[0].link).toBe('https://example.com/1');
    });

    it('should respect max_results', async () => {
        const mockHtml = `
            <html><body>
                <a class="result-link" href="https://example.com/1">R1</a>
                <a class="result-link" href="https://example.com/2">R2</a>
                <a class="result-link" href="https://example.com/3">R3</a>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = JSON.parse(await webSearchTool.execute({ query: 'test', max_results: 2 }));
        expect(result).toHaveLength(2);
    });

    it('should return message when no results found', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('<html><body>No results</body></html>'),
        }) as any;

        const result = JSON.parse(await webSearchTool.execute({ query: 'xyznonexistent' }));
        expect(result.message).toContain('Search failed to find results for "xyznonexistent"');
    });

    it('should return graceful message on HTTP error', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
        }) as any;

        const result = JSON.parse(await webSearchTool.execute({ query: 'test' }));
        expect(result.message).toContain('Search failed to find results for "test"');
    });
});
