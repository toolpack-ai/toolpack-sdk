import { describe, it, expect, vi, afterEach } from 'vitest';
import { webFetchTool } from './index.js';

describe('web.fetch tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(webFetchTool.name).toBe('web.fetch');
        expect(webFetchTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(webFetchTool.execute({})).rejects.toThrow('url is required');
    });

    it('should throw if url has no scheme', async () => {
        await expect(webFetchTool.execute({ url: 'example.com' })).rejects.toThrow('url must start with http');
    });

    it('should fetch a URL and return body', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve('<html>hello</html>'),
        }) as any;

        const result = await webFetchTool.execute({ url: 'https://example.com' });
        expect(result).toContain('<html>hello</html>');
    });

    it('should return error info for non-ok responses', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            text: () => Promise.resolve('error'),
        }) as any;

        const result = await webFetchTool.execute({ url: 'https://example.com' });
        expect(result).toContain('HTTP 500');
    });
});
