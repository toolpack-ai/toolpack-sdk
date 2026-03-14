import * as cheerio from 'cheerio';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { loadToolsConfig } from '../../../config-loader.js';

const SEARCH_URL = 'https://lite.duckduckgo.com/lite/';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1';

interface SearchResult {
    title: string;
    link: string;
    snippet: string;
}

function parseDuckDuckGoLite(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    const links = $('a.result-link');
    links.each((_i, element) => {
        if (results.length >= maxResults) return;

        const a = $(element);
        const title = a.text().trim();
        const link = a.attr('href');

        let snippet = a.siblings('.result-snippet').text().trim();
        if (!snippet) {
            const parentText = a.parent().text();
            snippet = parentText.replace(title, '').trim();
        }

        if (title && link) {
            results.push({
                title,
                link,
                snippet: snippet.slice(0, 200),
            });
        }
    });
    return results;
}

async function execute(args: Record<string, any>): Promise<string> {
    const query = args.query as string;
    const maxResults = (args.max_results || 5) as number;
    const includeAnswer = (args.include_answer || false) as boolean;
    const freshness = args.freshness as 'day' | 'week' | 'month' | 'year' | undefined;
    const timeoutMsg = `Request timed out after ${args.timeout || 30000}ms`;

    const getSignal = () => {
        const controller = new AbortController();
        const abortTimeout = setTimeout(() => controller.abort(), (args.timeout || 30000) as number);
        return { signal: controller.signal, clear: () => clearTimeout(abortTimeout) };
    };

    if (!query) {
        throw new Error('query is required');
    }

    const config = loadToolsConfig();

    if (config.additionalConfigurations?.webSearch?.tavilyApiKey) {
        try {
            const { signal, clear } = getSignal();
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: config.additionalConfigurations.webSearch.tavilyApiKey,
                    query: query,
                    max_results: maxResults,
                    include_answer: includeAnswer,
                    ...(freshness && { days: freshness }),
                }),
                signal,
            }).finally(clear);

            if (response.ok) {
                const data = await response.json() as any;
                if (data.results && data.results.length > 0) {
                    const results: SearchResult[] = data.results.map((r: any) => ({
                        title: r.title,
                        link: r.url,
                        snippet: r.content,
                    }));
                    
                    // If answer is included, return structured response with answer + results
                    if (includeAnswer && data.answer) {
                        return JSON.stringify({
                            answer: data.answer,
                            results
                        }, null, 2);
                    }
                    
                    return JSON.stringify(results, null, 2);
                }
            }
        } catch (e) {
            console.error('Tavily search failed, falling back...', e);
        }
    }

    if (config.additionalConfigurations?.webSearch?.braveApiKey) {
        try {
            const { signal, clear } = getSignal();
            
            // If answer is requested, use 2-step Brave Summarizer flow
            if (includeAnswer) {
                // Map freshness to Brave format
                const freshnessParam = freshness ? `&freshness=${freshness === 'day' ? 'pd' : freshness === 'week' ? 'pw' : freshness === 'month' ? 'pm' : 'py'}` : '';
                
                // Step 1: Get web search results with summary flag
                const searchResponse = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}&summary=1${freshnessParam}`, {
                    headers: {
                        'Accept': 'application/json',
                        'Accept-Encoding': 'gzip',
                        'X-Subscription-Token': config.additionalConfigurations.webSearch.braveApiKey,
                    },
                    signal,
                }).finally(clear);

                if (searchResponse.ok) {
                    const searchData = await searchResponse.json() as any;
                    const summaryKey = searchData.summarizer?.key;
                    
                    if (summaryKey && searchData.web?.results) {
                        // Step 2: Fetch the summary using the key
                        const { signal: signal2, clear: clear2 } = getSignal();
                        const summaryResponse = await fetch(`https://api.search.brave.com/res/v1/summarizer/search?key=${summaryKey}`, {
                            headers: {
                                'Accept': 'application/json',
                                'X-Subscription-Token': config.additionalConfigurations.webSearch.braveApiKey,
                            },
                            signal: signal2,
                        }).finally(clear2);

                        if (summaryResponse.ok) {
                            const summaryData = await summaryResponse.json() as any;
                            const results: SearchResult[] = searchData.web.results.slice(0, maxResults).map((r: any) => ({
                                title: r.title,
                                link: r.url,
                                snippet: r.description,
                            }));
                            
                            // Extract answer from summary
                            const answer = summaryData.summary?.map((s: any) => s.data).join('\n') || summaryData.title;
                            
                            return JSON.stringify({
                                answer,
                                results
                            }, null, 2);
                        }
                    }
                    
                    // Fallback: return results without summary if summary failed
                    if (searchData.web?.results) {
                        const results: SearchResult[] = searchData.web.results.slice(0, maxResults).map((r: any) => ({
                            title: r.title,
                            link: r.url,
                            snippet: r.description,
                        }));
                        return JSON.stringify(results, null, 2);
                    }
                }
            } else {
                // Map freshness to Brave format
                const freshnessParam = freshness ? `&freshness=${freshness === 'day' ? 'pd' : freshness === 'week' ? 'pw' : freshness === 'month' ? 'pm' : 'py'}` : '';
                
                // Standard search without answer
                const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}${freshnessParam}`, {
                    headers: {
                        'Accept': 'application/json',
                        'Accept-Encoding': 'gzip',
                        'X-Subscription-Token': config.additionalConfigurations.webSearch.braveApiKey,
                    },
                    signal,
                }).finally(clear);

                if (response.ok) {
                    const data = await response.json() as any;
                    if (data.web?.results && data.web.results.length > 0) {
                        const results: SearchResult[] = data.web.results.slice(0, maxResults).map((r: any) => ({
                            title: r.title,
                            link: r.url,
                            snippet: r.description,
                        }));
                        return JSON.stringify(results, null, 2);
                    }
                }
            }
        } catch (e) {
            console.error('Brave search failed, falling back...', e);
        }
    }

    // 3. Final Fallback to DuckDuckGo Lite HTTP

    const { signal, clear } = getSignal();
    let response;
    try {
        response = await fetch(SEARCH_URL, {
            method: 'POST',
            headers: {
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://lite.duckduckgo.com',
                'Referer': 'https://lite.duckduckgo.com/',
            },
            body: new URLSearchParams({ q: query }).toString(),
            signal,
        });
    } catch (e: any) {
        if (e.name === 'AbortError') throw new Error(timeoutMsg);
        throw e;
    } finally {
        clear();
    }

    if (response.ok) {
        const html = await response.text();
        const results = parseDuckDuckGoLite(html, maxResults);

        if (results.length > 0) {
            return JSON.stringify(results, null, 2);
        }
    }

    // Graceful Error when all providers fail
    return JSON.stringify({
        error: 'search_unavailable',
        message: `Search failed to find results for "${query}" across all providers.`,
        suggestion: 'Please configure a search provider API key (tavilyApiKey or braveApiKey) in toolpack.config.json under tools.additionalConfigurations.webSearch.',
    });
}

export const webSearchTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
