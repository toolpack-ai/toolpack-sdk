import * as cheerio from 'cheerio';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const JUNK_SELECTORS = ['script', 'style', 'nav', 'footer', 'header', 'iframe', '.ads', '.sidebar', 'noscript'];
const CONTENT_SELECTORS = ['article', 'main', '.content', '#content', '[role="main"]', 'body'];
const MIN_CONTENT_LENGTH = 200;

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const selector = args.selector as string | undefined;
    const section = args.section as string | undefined;
    const format = (args.format || 'text') as 'text' | 'tables';
    const maxLength = (args.max_length || 6000) as number;
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

    // Remove junk elements
    for (const junk of JUNK_SELECTORS) {
        $(junk).remove();
    }

    if (format === 'tables') {
        const tables: any[] = [];
        $('table').each((i, tableEl) => {
            const tableData: any[] = [];
            const headers: string[] = [];

            // Extract headers if present
            $(tableEl).find('th').each((_, th) => {
                headers.push($(th).text().trim());
            });

            // Extract rows
            $(tableEl).find('tr').each((_, tr) => {
                const rowData: Record<string, string> | string[] = headers.length > 0 ? {} : [];
                const cells = $(tr).find('td');

                if (cells.length > 0) {
                    cells.each((colIdx, td) => {
                        const text = $(td).text().trim();
                        if (headers.length > 0 && headers[colIdx]) {
                            (rowData as Record<string, string>)[headers[colIdx]] = text;
                        } else {
                            (rowData as string[]).push(text);
                        }
                    });
                    tableData.push(rowData);
                }
            });

            if (tableData.length > 0) {
                tables.push({ id: `Table ${i + 1}`, headers: headers.length > 0 ? headers : undefined, rows: tableData });
            }
        });

        if (tables.length === 0) {
            return `No tables found on ${url}`;
        }
        return JSON.stringify(tables, null, 2);
    }

    let content = '';

    // Section-based extraction (natural language targeting)
    if (section) {
        const sectionLower = section.toLowerCase();
        let foundHeadingEl: any = null;
        let headingLevel = 0;

        // Find heading containing the section text
        $('h1, h2, h3, h4, h5, h6').each((_, element) => {
            const headingText = $(element).text().toLowerCase();
            if (headingText.includes(sectionLower)) {
                foundHeadingEl = element;
                headingLevel = parseInt(element.tagName.charAt(1));
                return false; // break
            }
            return undefined;
        });

        if (foundHeadingEl) {
            const foundHeading = $(foundHeadingEl);
            // Extract content from this heading until the next same-level heading
            const sectionContent: string[] = [];
            let current = foundHeading.next();

            while (current.length > 0) {
                const tagName = current.prop('tagName')?.toLowerCase();

                // Stop if we hit another heading of same or higher level
                if (tagName && /^h[1-6]$/.test(tagName)) {
                    const currentLevel = parseInt(tagName.charAt(1));
                    if (currentLevel <= headingLevel) {
                        break;
                    }
                }

                // Get text from this element (includes nested content)
                const text = current.text().trim();
                if (text) {
                    sectionContent.push(text);
                }
                current = current.next();
            }

            if (sectionContent.length > 0) {
                content = sectionContent.join('\n\n').replace(/\s+/g, ' ').trim();
                content = `[Section: "${section}"]\n\n${content}`;
            } else {
                content = `[Note: Found heading "${section}" but no content below it. Falling back to full page.]\n\n`;
            }
        } else {
            content = `[Note: Section "${section}" not found. Falling back to full page.]

`;
        }
    }

    // Only run selector/auto-detect if section extraction didn't find content
    const needsFallback = !content || content.includes('Falling back to full page');
    if (needsFallback) {
        // Clear the fallback message if present
        if (content && content.includes('Falling back to full page')) {
            content = '';
        }

        if (selector) {
            // User-specified selector
            const element = $(selector);
            if (element.length > 0) {
                content = element.text().replace(/\s+/g, ' ').trim();
            } else {
                // Selector not found — fall back to auto-detect
                for (const sel of CONTENT_SELECTORS) {
                    const element = $(sel);
                    if (element.length > 0) {
                        const text = element.text().replace(/\s+/g, ' ').trim();
                        if (text.length > MIN_CONTENT_LENGTH) {
                            content = text;
                            break;
                        }
                    }
                }
                if (content) {
                    content = `[Note: Selector "${selector}" not found. Showing auto-detected main content instead.]\n\n${content}`;
                } else {
                    return `No element found matching selector "${selector}" and could not auto-detect main content from ${url}`;
                }
            }
        } else {
            // Auto-detect main content using cascade
            for (const sel of CONTENT_SELECTORS) {
                const element = $(sel);
                if (element.length > 0) {
                    const text = element.text().replace(/\s+/g, ' ').trim();
                    if (text.length > MIN_CONTENT_LENGTH) {
                        content = text;
                        break;
                    }
                }
            }
        }
    }

    // Final fallback: grab whatever text remains (even if minimal)
    if (!content) {
        content = $('body').text().replace(/\s+/g, ' ').trim();
        if (content) {
            content = `[Note: Could not detect main content area. Showing full page text (may include navigation).]\n\n${content}`;
        }
    }

    if (!content) {
        return `Could not extract any content from ${url}`;
    }

    // Intelligent chunking: if content is too large, guide the AI to use better strategies
    if (content.length > maxLength) {
        const truncated = content.substring(0, maxLength);
        return `[Warning: Content exceeds ${maxLength} chars (actual: ${content.length} chars). Showing first ${maxLength} chars only.]

RECOMMENDATION: Use web.map to see page structure, then use web.scrape with section parameter to extract specific sections.

Page content from ${url}:

${truncated}

... [Content truncated. ${content.length - maxLength} chars remaining. Use section parameter to extract specific sections.]`;
    }

    return `Page content from ${url}:\n\n${content}`;
}

export const webScrapeTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
