import * as cheerio from 'cheerio';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

async function fetchWithTimeout(url: string, timeout: number) {
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        return response;
    } catch (e: any) {
        if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeout}ms`);
        throw e;
    } finally {
        clearTimeout(abortTimeout);
    }
}

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const maxUrls = (args.max_urls || 100) as number;
    const timeout = (args.timeout || 30000) as number;

    if (!url) {
        throw new Error('url is required');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('url must start with http:// or https://');
    }

    let targetUrl = url;
    let fallbackToRobots = false;

    // Auto-append if it's a base domain
    if (!url.endsWith('.xml') && !url.endsWith('.txt')) {
        targetUrl = new URL(url.endsWith('/') ? 'sitemap.xml' : '/sitemap.xml', url).toString();
        fallbackToRobots = true;
    }

    let response;
    try {
        response = await fetchWithTimeout(targetUrl, timeout);
        if (!response.ok && fallbackToRobots) {
            targetUrl = new URL(url.endsWith('/') ? 'robots.txt' : '/robots.txt', url).toString();
            response = await fetchWithTimeout(targetUrl, timeout);
        }
    } catch (e) {
        if (fallbackToRobots) {
            targetUrl = new URL(url.endsWith('/') ? 'robots.txt' : '/robots.txt', url).toString();
            response = await fetchWithTimeout(targetUrl, timeout);
        } else {
            throw e;
        }
    }

    if (!response || !response.ok) {
        throw new Error(`Failed to fetch sitemap or robots.txt from ${url}`);
    }

    const content = await response.text();
    const urls: Array<{ loc: string; lastmod?: string; priority?: string }> = [];

    if (targetUrl.endsWith('.xml') || content.trim().startsWith('<')) {
        const $ = cheerio.load(content, { xmlMode: true });

        // Handle sitemap index files
        const sitemaps = $('sitemap > loc');
        if (sitemaps.length > 0) {
            sitemaps.each((_, el) => {
                if (urls.length >= maxUrls) return;
                urls.push({ loc: $(el).text() });
            });
            return JSON.stringify({
                type: 'sitemapindex',
                urls
            }, null, 2);
        }

        // Handle standard sitemaps
        const urlset = $('urlset > url');
        urlset.each((_, el) => {
            if (urls.length >= maxUrls) return;
            const $el = $(el);
            urls.push({
                loc: $el.children('loc').text(),
                lastmod: $el.children('lastmod').text() || undefined,
                priority: $el.children('priority').text() || undefined
            });
        });

    } else {
        // Parse robots.txt
        const lines = content.split('\n');
        for (const line of lines) {
            if (urls.length >= maxUrls) break;
            const l = line.trim();
            if (l.toLowerCase().startsWith('sitemap:')) {
                urls.push({ loc: l.substring(8).trim() });
            } else if (l.toLowerCase().startsWith('allow:')) {
                const path = l.substring(6).trim();
                urls.push({ loc: new URL(path, targetUrl).toString() });
            }
        }
    }

    return JSON.stringify(urls, null, 2);
}

export const webSitemapTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
