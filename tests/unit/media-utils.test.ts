import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { getMimeType, isDataUri, parseDataUri, toDataUri, readFileAsBase64, fetchUrlAsBase64, normalizeImagePart } from '../../src/providers/media-utils';
import { ImagePart } from '../../src/types';

vi.mock('fs/promises', () => ({
    readFile: vi.fn(),
}));

// Mock global fetch
const originalFetch = global.fetch;

describe('media-utils', () => {
    afterEach(() => {
        vi.clearAllMocks();
        global.fetch = originalFetch;
    });

    describe('getMimeType', () => {
        it('resolves common extensions', () => {
            expect(getMimeType('image.png')).toBe('image/png');
            expect(getMimeType('photo.JPG')).toBe('image/jpeg');
            expect(getMimeType('test.webp')).toBe('image/webp');
        });

        it('defaults to octet-stream for unknown extensions', () => {
            expect(getMimeType('test.unknown')).toBe('application/octet-stream');
            expect(getMimeType('noextension')).toBe('application/octet-stream');
        });
    });

    describe('isDataUri', () => {
        it('identifies valid data URIs', () => {
            expect(isDataUri('data:image/png;base64,iVBORw0KGgo')).toBe(true);
            expect(isDataUri('http://example.com/image.png')).toBe(false);
            expect(isDataUri('file:///path/to/image.png')).toBe(false);
        });
    });

    describe('parseDataUri', () => {
        it('parses valid base64 data URIs', () => {
            const result = parseDataUri('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAA');
            expect(result).toEqual({
                mimeType: 'image/jpeg',
                data: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAA'
            });
        });

        it('returns null for invalid data URIs', () => {
            expect(parseDataUri('data:image/png;invalid')).toBeNull();
            expect(parseDataUri('http://example.com/test.png')).toBeNull();
        });
    });

    describe('toDataUri', () => {
        it('formats correctly', () => {
            expect(toDataUri('hello', 'text/plain')).toBe('data:text/plain;base64,hello');
        });
    });

    describe('readFileAsBase64', () => {
        it('reads a file and converts to base64', async () => {
            vi.mocked(fs.readFile).mockResolvedValueOnce(Buffer.from('test data'));
            const result = await readFileAsBase64('/fake/path/image.png');
            expect(result).toEqual({
                data: Buffer.from('test data').toString('base64'),
                mimeType: 'image/png'
            });
            expect(fs.readFile).toHaveBeenCalledWith('/fake/path/image.png');
        });

        it('throws an InvalidRequestError if read fails', async () => {
            vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));
            await expect(readFileAsBase64('/fake/path/missing.png')).rejects.toThrow(/Failed to read image file/);
        });
    });

    describe('fetchUrlAsBase64', () => {
        it('fetches a URL and converts to base64', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'content-type': 'image/jpeg' }),
                arrayBuffer: async () => Buffer.from('test image data'),
            } as any);

            const result = await fetchUrlAsBase64('http://example.com/image.jpg');
            expect(result).toEqual({
                data: Buffer.from('test image data').toString('base64'),
                mimeType: 'image/jpeg'
            });
            expect(global.fetch).toHaveBeenCalledWith('http://example.com/image.jpg');
        });

        it('throws ProviderError on fetch failure', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found'
            } as any);

            await expect(fetchUrlAsBase64('http://example.com/missing.jpg')).rejects.toThrow(/Failed to download image/);
        });
    });

    describe('normalizeImagePart', () => {
        it('handles ImageDataPart directly', async () => {
            const part: ImagePart = { type: 'image_data', image_data: { data: 'abc', mimeType: 'image/png' } };
            const result = await normalizeImagePart(part);
            expect(result).toEqual({ data: 'abc', mimeType: 'image/png' });
        });

        it('handles ImageFilePart by reading file', async () => {
            vi.mocked(fs.readFile).mockResolvedValueOnce(Buffer.from('file content'));
            const part: ImagePart = { type: 'image_file', image_file: { path: '/foo/bar.png' } };
            const result = await normalizeImagePart(part);
            expect(result).toEqual({
                data: Buffer.from('file content').toString('base64'),
                mimeType: 'image/png'
            });
        });

        it('handles ImageUrlPart with data URI without fetching', async () => {
            global.fetch = vi.fn(); // Mock it to ensure we can spy on it
            const part: ImagePart = { type: 'image_url', image_url: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' } };
            const result = await normalizeImagePart(part);
            expect(result).toEqual({
                data: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                mimeType: 'image/gif'
            });
            expect(global.fetch).not.toHaveBeenCalled();
            global.fetch = originalFetch; // restore
        });

        it('handles ImageUrlPart with http URL by fetching', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'content-type': 'image/webp' }),
                arrayBuffer: async () => Buffer.from('mock webp'),
            } as any);
            const part: ImagePart = { type: 'image_url', image_url: { url: 'http://example.com/image.webp' } };
            const result = await normalizeImagePart(part);
            expect(result).toEqual({
                data: Buffer.from('mock webp').toString('base64'),
                mimeType: 'image/webp'
            });
        });
    });
});
