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

    // Extract all headings with their hierarchy
    const headings: Array<{ level: number; text: string }> = [];

    $('h1, h2, h3, h4, h5, h6').each((_, element) => {
        const tagName = element.tagName.toLowerCase();
        const level = parseInt(tagName.charAt(1));
        const text = $(element).text().trim();

        if (text) {
            headings.push({ level, text });
        }
    });

    if (headings.length === 0) {
        return `No headings found on ${url}. The page may not have a clear structure.`;
    }

    // Format as a hierarchical outline
    let outline = `Page outline for ${url}:\n\n`;
    for (const heading of headings) {
        const indent = '  '.repeat(heading.level - 1);
        outline += `${indent}${'#'.repeat(heading.level)} ${heading.text}\n`;
    }

    return outline;
}

export const webMapTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
