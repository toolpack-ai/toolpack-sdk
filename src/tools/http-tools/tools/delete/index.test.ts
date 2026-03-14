import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpDeleteTool } from './index.js';

describe('http.delete tool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(httpDeleteTool.name).toBe('http.delete');
        expect(httpDeleteTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(httpDeleteTool.execute({})).rejects.toThrow('url is required');
    });

    it('should make a DELETE request', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true, status: 204, statusText: 'No Content',
            text: () => Promise.resolve(''),
        }) as any;

        const result = await httpDeleteTool.execute({ url: 'https://example.com/api/1' });
        expect(result).toContain('HTTP 204');
        expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/api/1', expect.objectContaining({ method: 'DELETE' }));
    });
});
