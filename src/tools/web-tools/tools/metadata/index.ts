import * as cheerio from 'cheerio';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
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

    const metadata: Record<string, any> = {
        title: $('title').text() || '',
        description: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
        author: $('meta[name="author"]').attr('content') || '',
        openGraph: {},
        twitter: {},
        jsonLd: []
    };

    $('meta[property^="og:"]').each((_, el) => {
        const prop = $(el).attr('property')?.replace('og:', '');
        const content = $(el).attr('content');
        if (prop && content) metadata.openGraph[prop] = content;
    });

    $('meta[name^="twitter:"]').each((_, el) => {
        const metaName = $(el).attr('name')?.replace('twitter:', '');
        const content = $(el).attr('content');
        if (metaName && content) metadata.twitter[metaName] = content;
    });

    $('script[type="application/ld+json"]').each((_, el) => {
        const content = $(el).html();
        if (content) {
            try {
                metadata.jsonLd.push(JSON.parse(content));
            } catch (e) {
                // Ignore parse errors
            }
        }
    });

    return JSON.stringify(metadata, null, 2);
}

export const webMetadataTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
