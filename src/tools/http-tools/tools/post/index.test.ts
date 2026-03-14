import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpPostTool } from './index.js';

describe('http.post tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(httpPostTool.name).toBe('http.post');
        expect(httpPostTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(httpPostTool.execute({})).rejects.toThrow('url is required');
    });

    it('should make a POST request with body', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve('{"ok":true}'),
        }) as any;

        const result = await httpPostTool.execute({ url: 'https://example.com/api', body: '{"key":"val"}' });
        expect(result).toContain('HTTP 200 OK');
        expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({ method: 'POST' }));
    });

    it('should auto-detect JSON content type', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('ok'),
        }) as any;

        await httpPostTool.execute({ url: 'https://example.com', body: '{"a":1}' });
        const callArgs = (globalThis.fetch as any).mock.calls[0][1];
        expect(callArgs.headers['Content-Type']).toBe('application/json');
    });
});
