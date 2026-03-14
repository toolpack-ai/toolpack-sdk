import * as cheerio from 'cheerio';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

interface ExtractedLink {
    text: string;
    url: string;
}

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const filter = args.filter as string | undefined;
    const timeout = (args.timeout || 30000) as number;

    if (!url) {
        throw new Error('url is required');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('url must start with http:// or https://');
    }

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
    } catch (e: any) {
        if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeout}ms`);
        throw e;
    } finally {
        clearTimeout(abortTimeout);
    }

    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const baseUrl = new URL(url);
    const links: ExtractedLink[] = [];

    $('a[href]').each((_i, element) => {
        const a = $(element);
        const href = a.attr('href');
        if (!href) return;

        // Resolve relative URLs
        let resolvedUrl: string;
        try {
            resolvedUrl = new URL(href, url).toString();
        } catch {
            return; // Skip malformed URLs
        }

        // Skip anchors, javascript:, mailto:, etc.
        if (resolvedUrl.startsWith('javascript:') || resolvedUrl.startsWith('mailto:') || resolvedUrl.startsWith('tel:')) {
            return;
        }

        const text = a.text().trim() || '[no text]';

        // Apply filter
        if (filter) {
            if (filter === 'same-domain') {
                try {
                    const linkDomain = new URL(resolvedUrl).hostname;
                    if (linkDomain !== baseUrl.hostname) return;
                } catch {
                    return;
                }
            } else {
                if (!resolvedUrl.includes(filter)) return;
            }
        }

        links.push({ text, url: resolvedUrl });
    });

    if (links.length === 0) {
        return `No links found on ${url}${filter ? ` matching filter "${filter}"` : ''}`;
    }

    return JSON.stringify(links, null, 2);
}

export const webExtractLinksTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
