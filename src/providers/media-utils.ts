import * as fs from 'fs/promises';
import * as path from 'path';
import { ImagePart } from '../types';
import { InvalidRequestError, ProviderError } from '../errors';

const EXT_TO_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
};

export function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function isDataUri(url: string): boolean {
    return url.startsWith('data:');
}

export function parseDataUri(dataUri: string): { mimeType: string; data: string } | null {
    const match = dataUri.match(/^data:(.*?);base64,(.+)$/);
    if (!match) return null;
    return {
        mimeType: match[1],
        data: match[2],
    };
}

export function toDataUri(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`;
}

export async function readFileAsBase64(filePath: string): Promise<{ data: string; mimeType: string }> {
    try {
        const buffer = await fs.readFile(filePath);
        return {
            data: buffer.toString('base64'),
            mimeType: getMimeType(filePath),
        };
    } catch (err: any) {
        throw new InvalidRequestError(`Failed to read image file: ${filePath}`, err);
    }
}

export async function fetchUrlAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        let mimeType = response.headers.get('content-type') || 'application/octet-stream';
        // Cleanup mime type if it contains charset e.g. "image/jpeg; charset=utf-8"
        mimeType = mimeType.split(';')[0].trim();

        return {
            data: buffer.toString('base64'),
            mimeType,
        };
    } catch (err: any) {
        throw new ProviderError(`Failed to download image from URL: ${url}`, 'FETCH_ERROR', 500, err);
    }
}

export async function normalizeImagePart(part: ImagePart): Promise<{ data: string; mimeType: string }> {
    if (part.type === 'image_data') {
        return {
            data: part.image_data.data,
            mimeType: part.image_data.mimeType,
        };
    }
    if (part.type === 'image_file') {
        return await readFileAsBase64(part.image_file.path);
    }
    if (part.type === 'image_url') {
        const url = part.image_url.url;
        if (isDataUri(url)) {
            const parsed = parseDataUri(url);
            if (!parsed) {
                throw new InvalidRequestError(`Malformed data URI provided in image_url: ${url.substring(0, 50)}...`);
            }
            return parsed;
        }
        return await fetchUrlAsBase64(url);
    }
    throw new InvalidRequestError(`Unknown ImagePart type: ${(part as any).type}`);
}
