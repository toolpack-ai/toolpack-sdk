import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpGetTool } from './index.js';

describe('http.get tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(httpGetTool.name).toBe('http.get');
        expect(httpGetTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(httpGetTool.execute({})).rejects.toThrow('url is required');
    });

    it('should throw if url has no scheme', async () => {
        await expect(httpGetTool.execute({ url: 'example.com' })).rejects.toThrow('url must start with http');
    });

    it('should make a GET request', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve('response body'),
        }) as any;

        const result = await httpGetTool.execute({ url: 'https://example.com' });
        expect(result).toContain('HTTP 200 OK');
        expect(result).toContain('response body');
        expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', { method: 'GET', headers: {} });
    });

    it('should include error status for non-ok responses', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: () => Promise.resolve('not found'),
        }) as any;

        const result = await httpGetTool.execute({ url: 'https://example.com/missing' });
        expect(result).toContain('HTTP 404');
        expect(result).toContain('not found');
    });
});
