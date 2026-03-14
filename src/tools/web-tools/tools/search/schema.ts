import { ToolParameters } from '../../../types.js';

export const name = 'web.search';
export const displayName = 'Search';
export const description = 'Search the web using multiple providers (Tavily, Brave, DuckDuckGo Lite) with automatic fallback. Supports real-time results via freshness parameter and AI-generated answers. Configure API keys via environment variables (TOOLPACK_TAVILY_API_KEY, TOOLPACK_BRAVE_API_KEY) or toolpack.config.json for best results.';
export const category = 'network';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        query: {
            type: 'string',
            description: 'The search query',
        },
        max_results: {
            type: 'integer',
            description: 'Maximum number of results to return (default: 5)',
            default: 5,
        },
        timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default: 30000)',
            default: 30000,
        },
        include_answer: {
            type: 'boolean',
            description: 'Include AI-generated answer summary (works with Tavily and Brave APIs). Default: false',
            default: false,
        },
        freshness: {
            type: 'string',
            description: 'Time range for results: "day" (24h), "week" (7d), "month" (31d), "year" (1y). Ensures real-time/recent results. Works with Tavily and Brave.',
            enum: ['day', 'week', 'month', 'year'],
        },
    },
    required: ['query'],
};
