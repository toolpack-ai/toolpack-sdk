import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { loadRssParser } from '../../utils/rss-loader.js';

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const maxEntries = (args.max_entries || 10) as number;
    const timeout = (args.timeout || 30000) as number;

    if (!url) {
        throw new Error('url is required');
    }

    const parser = await loadRssParser();
    (parser as any).options = { ...(parser as any).options, timeout };

    try {
        const feed = await parser.parseURL(url);
        const entries = feed.items.slice(0, maxEntries).map((item: any) => ({
            title: item.title,
            link: item.link,
            published: item.pubDate || item.isoDate,
            summary: item.contentSnippet || item.content,
        }));

        return JSON.stringify({
            feedTitle: feed.title,
            feedDescription: feed.description,
            entries
        }, null, 2);
    } catch (e: any) {
        throw new Error(`Failed to parse feed from ${url}: ${e.message}`);
    }
}

export const webFeedTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
