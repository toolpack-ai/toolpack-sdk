import { describe, it, expect, vi, afterEach } from 'vitest';
import { webScrapeTool } from './index.js';

describe('web.scrape tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(webScrapeTool.name).toBe('web.scrape');
        expect(webScrapeTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(webScrapeTool.execute({})).rejects.toThrow('url is required');
    });

    it('should throw if url has no scheme', async () => {
        await expect(webScrapeTool.execute({ url: 'example.com' })).rejects.toThrow('url must start with http');
    });

    it('should extract content from article tag', async () => {
        const mockHtml = `
            <html><body>
                <nav>Navigation</nav>
                <article>This is the main article content that is long enough to pass the minimum threshold for content extraction from the page. We need to ensure this text exceeds two hundred characters so the scraper considers it meaningful content and does not skip it as a menu or navigation fragment.</article>
                <footer>Footer stuff</footer>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = await webScrapeTool.execute({ url: 'https://example.com' });
        expect(result).toContain('main article content');
        expect(result).not.toContain('Navigation');
        expect(result).not.toContain('Footer stuff');
    });

    it('should use custom selector when provided', async () => {
        const mockHtml = `
            <html><body>
                <div class="target">Targeted content here</div>
                <div class="other">Other content</div>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = await webScrapeTool.execute({ url: 'https://example.com', selector: '.target' });
        expect(result).toContain('Targeted content here');
    });

    it('should truncate long content', async () => {
        const longContent = 'A'.repeat(10000);
        const mockHtml = `<html><body><article>${longContent}</article></body></html>`;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = await webScrapeTool.execute({ url: 'https://example.com', max_length: 500 });
        expect(result).toContain('Content truncated');
        expect(result).toContain('500');
    });

    it('should report when no content found', async () => {
        const mockHtml = `<html><body><nav>Just nav</nav></body></html>`;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = await webScrapeTool.execute({ url: 'https://example.com' });
        expect(result).toContain('Could not extract');
    });

    it('should throw on HTTP error', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        }) as any;

        await expect(webScrapeTool.execute({ url: 'https://example.com/missing' })).rejects.toThrow('Failed to fetch');
    });
});
