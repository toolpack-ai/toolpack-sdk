import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { httpDownloadTool } from './index.js';

describe('http.download tool', () => {
    let tmpDir: string;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-download-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        globalThis.fetch = originalFetch;
    });

    it('should have correct metadata', () => {
        expect(httpDownloadTool.name).toBe('http.download');
        expect(httpDownloadTool.category).toBe('network');
    });

    it('should throw if url is missing', async () => {
        await expect(httpDownloadTool.execute({ path: '/tmp/x' })).rejects.toThrow('url is required');
    });

    it('should throw if path is missing', async () => {
        await expect(httpDownloadTool.execute({ url: 'https://example.com' })).rejects.toThrow('path is required');
    });

    it('should download and save a file', async () => {
        const content = Buffer.from('file content here');
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            arrayBuffer: () => Promise.resolve(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)),
        }) as any;

        const filePath = path.join(tmpDir, 'downloaded.txt');
        const result = await httpDownloadTool.execute({ url: 'https://example.com/file.txt', path: filePath });
        expect(result).toContain('Downloaded');
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should throw on non-ok response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        }) as any;

        await expect(httpDownloadTool.execute({ url: 'https://example.com/missing', path: path.join(tmpDir, 'x') })).rejects.toThrow('Download failed');
    });
});
