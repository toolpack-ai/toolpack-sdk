/**
 * HTML Content Extractor
 * Extracts structured data from HTML content instead of returning raw HTML.
 * Follows ChatGPT/Claude patterns for web browsing tools.
 */

import * as cheerio from 'cheerio';

export interface StructuredContent {
    title: string;
    url: string;
    author?: string;
    publishDate?: string;
    excerpt: string;
    mainContent: string;
    keyPoints: string[];
    wordCount: number;
}

export interface MinimalContent {
    title: string;
    url: string;
    snippet: string;
}

/**
 * Extract structured content from HTML
 */
export function extractStructured(html: string, url: string): StructuredContent {
    const $ = cheerio.load(html);
    
    // Remove script, style, and nav elements
    $('script, style, nav, header, footer, aside, .advertisement, .ad, .sidebar').remove();
    
    // Extract title
    const title = $('title').text().trim() || 
                  $('h1').first().text().trim() || 
                  $('meta[property="og:title"]').attr('content') || 
                  'Untitled';
    
    // Extract author
    const author = $('meta[name="author"]').attr('content') ||
                   $('meta[property="article:author"]').attr('content') ||
                   $('.author').first().text().trim() ||
                   undefined;
    
    // Extract publish date
    const publishDate = $('meta[property="article:published_time"]').attr('content') ||
                        $('time').first().attr('datetime') ||
                        $('.date, .published').first().text().trim() ||
                        undefined;
    
    // Extract main content
    const contentSelectors = [
        'article',
        'main',
        '[role="main"]',
        '.content',
        '.article-content',
        '.post-content',
        '#content'
    ];
    
    let mainContent = '';
    for (const selector of contentSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
            mainContent = element.text().trim();
            if (mainContent.length > 200) break;
        }
    }
    
    // Fallback to body if no main content found
    if (!mainContent || mainContent.length < 200) {
        mainContent = $('body').text().trim();
    }
    
    // Clean up whitespace
    mainContent = mainContent.replace(/\s+/g, ' ').trim();
    
    // Extract first 3 paragraphs for excerpt
    const paragraphs: string[] = [];
    $('p').each((_i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 50 && paragraphs.length < 3) {
            paragraphs.push(text);
        }
    });
    const excerpt = paragraphs.join('\n\n') || mainContent.substring(0, 500);
    
    // Extract key points from headings
    const keyPoints: string[] = [];
    $('h2, h3').each((_i, elem) => {
        const text = $(elem).text().trim();
        if (text && text.length > 5 && text.length < 200 && keyPoints.length < 10) {
            keyPoints.push(text);
        }
    });
    
    // Word count
    const wordCount = mainContent.split(/\s+/).length;
    
    // Limit main content to 2000 words (~8000 chars)
    const words = mainContent.split(/\s+/);
    if (words.length > 2000) {
        mainContent = words.slice(0, 2000).join(' ') + '...';
    }
    
    return {
        title,
        url,
        author,
        publishDate,
        excerpt: excerpt.substring(0, 1000),
        mainContent: mainContent.substring(0, 10000),
        keyPoints,
        wordCount
    };
}

/**
 * Extract minimal content (title + snippet)
 */
export function extractMinimal(html: string, url: string): MinimalContent {
    const $ = cheerio.load(html);
    
    // Remove script, style, nav
    $('script, style, nav, header, footer').remove();
    
    // Extract title
    const title = $('title').text().trim() || 
                  $('h1').first().text().trim() || 
                  'Untitled';
    
    // Extract snippet from first paragraph or meta description
    let snippet = $('meta[name="description"]').attr('content') ||
                  $('meta[property="og:description"]').attr('content') ||
                  '';
    
    if (!snippet) {
        $('p').each((_i, elem) => {
            const text = $(elem).text().trim();
            if (text.length > 50 && !snippet) {
                snippet = text;
            }
        });
    }
    
    // Fallback to body text
    if (!snippet) {
        snippet = $('body').text().trim().replace(/\s+/g, ' ');
    }
    
    return {
        title,
        url,
        snippet: snippet.substring(0, 500)
    };
}

/**
 * Format structured content as readable text
 */
export function formatStructured(content: StructuredContent): string {
    const parts: string[] = [];
    
    parts.push(`# ${content.title}`);
    parts.push(`URL: ${content.url}`);
    
    if (content.author) {
        parts.push(`Author: ${content.author}`);
    }
    
    if (content.publishDate) {
        parts.push(`Published: ${content.publishDate}`);
    }
    
    parts.push(`Word Count: ${content.wordCount}`);
    parts.push('');
    
    if (content.keyPoints.length > 0) {
        parts.push('## Key Points');
        content.keyPoints.forEach(point => {
            parts.push(`- ${point}`);
        });
        parts.push('');
    }
    
    parts.push('## Excerpt');
    parts.push(content.excerpt);
    parts.push('');
    
    parts.push('## Main Content');
    parts.push(content.mainContent);
    
    return parts.join('\n');
}

/**
 * Format minimal content as readable text
 */
export function formatMinimal(content: MinimalContent): string {
    return `# ${content.title}\nURL: ${content.url}\n\n${content.snippet}`;
}
