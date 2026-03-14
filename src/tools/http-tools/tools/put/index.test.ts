import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpPutTool } from './index.js';

describe('http.put tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(httpPutTool.name).toBe('http.put');
        expect(httpPutTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(httpPutTool.execute({})).rejects.toThrow('url is required');
    });

    it('should make a PUT request', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true, status: 200, statusText: 'OK',
            text: () => Promise.resolve('updated'),
        }) as any;

        const result = await httpPutTool.execute({ url: 'https://example.com/api/1', body: '{"name":"new"}' });
        expect(result).toContain('HTTP 200 OK');
        expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/api/1', expect.objectContaining({ method: 'PUT' }));
    });
});
