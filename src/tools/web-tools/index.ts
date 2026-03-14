import { ToolProject } from '../types.js';
import { webFetchTool } from './tools/fetch/index.js';
import { webSearchTool } from './tools/search/index.js';
import { webScrapeTool } from './tools/scrape/index.js';
import { webExtractLinksTool } from './tools/extract-links/index.js';
import { webMapTool } from './tools/map/index.js';
import { webMetadataTool } from './tools/metadata/index.js';
import { webSitemapTool } from './tools/sitemap/index.js';
import { webFeedTool } from './tools/feed/index.js';
import { webScreenshotTool } from './tools/screenshot/index.js';

export { webFetchTool } from './tools/fetch/index.js';
export { webSearchTool } from './tools/search/index.js';
export { webScrapeTool } from './tools/scrape/index.js';
export { webExtractLinksTool } from './tools/extract-links/index.js';
export { webMapTool } from './tools/map/index.js';
export { webMetadataTool } from './tools/metadata/index.js';
export { webSitemapTool } from './tools/sitemap/index.js';
export { webFeedTool } from './tools/feed/index.js';
export { webScreenshotTool } from './tools/screenshot/index.js';

export const webToolsProject: ToolProject = {
    manifest: {
        key: 'web',
        name: 'web-tools',
        displayName: 'Web',
        version: '1.0.0',
        description: 'Web intelligence tools for fetching, searching, scraping, and extracting content from the web.',
        author: 'Sajeer',
        tools: [
            'web.fetch', 'web.search', 'web.scrape', 'web.extract_links', 'web.map',
            'web.metadata', 'web.sitemap', 'web.feed', 'web.screenshot'
        ],
        category: 'network',
    },
    tools: [
        webFetchTool, webSearchTool, webScrapeTool, webExtractLinksTool, webMapTool,
        webMetadataTool, webSitemapTool, webFeedTool, webScreenshotTool
    ],
    dependencies: {
        'cheerio': '^1.0.0-rc.12',
    },
};
