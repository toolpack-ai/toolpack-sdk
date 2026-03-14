import { describe, it, expect, vi, afterEach } from 'vitest';
import { webExtractLinksTool } from './index.js';

describe('web.extract_links tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(webExtractLinksTool.name).toBe('web.extract_links');
        expect(webExtractLinksTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(webExtractLinksTool.execute({})).rejects.toThrow('url is required');
    });

    it('should extract links from a page', async () => {
        const mockHtml = `
            <html><body>
                <a href="https://example.com/page1">Page One</a>
                <a href="/relative">Relative Link</a>
                <a href="https://other.com">External</a>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = JSON.parse(await webExtractLinksTool.execute({ url: 'https://example.com' }));
        expect(result).toHaveLength(3);
        expect(result[0].text).toBe('Page One');
        expect(result[0].url).toBe('https://example.com/page1');
        expect(result[1].url).toBe('https://example.com/relative');
    });

    it('should filter by same-domain', async () => {
        const mockHtml = `
            <html><body>
                <a href="https://example.com/page1">Internal</a>
                <a href="https://other.com">External</a>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = JSON.parse(await webExtractLinksTool.execute({ url: 'https://example.com', filter: 'same-domain' }));
        expect(result).toHaveLength(1);
        expect(result[0].url).toBe('https://example.com/page1');
    });

    it('should filter by substring', async () => {
        const mockHtml = `
            <html><body>
                <a href="https://example.com/docs/api">API Docs</a>
                <a href="https://example.com/about">About</a>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = JSON.parse(await webExtractLinksTool.execute({ url: 'https://example.com', filter: '/docs/' }));
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('API Docs');
    });

    it('should skip javascript: and mailto: links', async () => {
        const mockHtml = `
            <html><body>
                <a href="javascript:void(0)">JS Link</a>
                <a href="mailto:test@test.com">Email</a>
                <a href="https://example.com/real">Real Link</a>
            </body></html>
        `;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(mockHtml),
        }) as any;

        const result = JSON.parse(await webExtractLinksTool.execute({ url: 'https://example.com' }));
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Real Link');
    });

    it('should return message when no links found', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('<html><body>No links here</body></html>'),
        }) as any;

        const result = await webExtractLinksTool.execute({ url: 'https://example.com' });
        expect(result).toContain('No links found');
    });
});
