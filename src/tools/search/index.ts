/**
 * Tool Search Module
 * 
 * Provides industry-standard tool discovery using BM25 ranking,
 * automatic caching, and the tool.search meta-tool.
 */

export { BM25SearchEngine, SearchOptions, SearchResult } from './bm25-engine.js';
export { ToolDiscoveryCache, SearchHistoryEntry } from './tool-cache.js';
export { 
    toolSearchDefinition, 
    getToolSearchSchema, 
    isToolSearchTool,
    TOOL_SEARCH_NAME 
} from './tool-search.js';
export { generateToolCategoriesPrompt } from './system-prompt.js';
