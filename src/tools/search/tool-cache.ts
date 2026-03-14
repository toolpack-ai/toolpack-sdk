/**
 * Tool Discovery Cache
 * 
 * Tracks tools discovered via tool.search in the current conversation.
 * Discovered tools are automatically included in subsequent requests.
 * 
 * This matches Anthropic's behavior:
 * "The system automatically expands tool_reference blocks throughout
 *  the entire conversation history, so Claude can reuse discovered
 *  tools in subsequent turns without re-searching."
 */

import { Message } from '../../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchHistoryEntry {
    query: string;
    tools: string[];
    timestamp: number;
}

// ── Tool Discovery Cache ─────────────────────────────────────────────────────

export class ToolDiscoveryCache {
    private discoveredTools: Set<string> = new Set();
    private searchHistory: SearchHistoryEntry[] = [];

    /**
     * Record tools discovered from a search result.
     */
    recordDiscovery(searchQuery: string, toolNames: string[]): void {
        for (const name of toolNames) {
            this.discoveredTools.add(name);
        }
        this.searchHistory.push({
            query: searchQuery,
            tools: toolNames,
            timestamp: Date.now(),
        });
    }

    /**
     * Get all tools discovered in this conversation.
     */
    getDiscoveredTools(): string[] {
        return Array.from(this.discoveredTools);
    }

    /**
     * Check if a tool was discovered (can be called without re-search).
     */
    isDiscovered(toolName: string): boolean {
        return this.discoveredTools.has(toolName);
    }

    /**
     * Get the number of discovered tools.
     */
    getDiscoveredCount(): number {
        return this.discoveredTools.size;
    }

    /**
     * Get search history.
     */
    getSearchHistory(): SearchHistoryEntry[] {
        return [...this.searchHistory];
    }

    /**
     * Extract discovered tools from conversation history.
     * Used for resuming conversations or loading from storage.
     */
    static fromMessages(messages: Message[]): ToolDiscoveryCache {
        const cache = new ToolDiscoveryCache();

        for (const msg of messages) {
            // Look for tool results from tool.search
            if (msg.role === 'tool') {
                const toolMsg = msg as any;
                // Check if this is a tool.search result by looking at the content
                if (typeof toolMsg.content === 'string') {
                    try {
                        const result = JSON.parse(toolMsg.content);
                        // Check if it looks like a tool.search result
                        if (result.query && result.tools && Array.isArray(result.tools)) {
                            const toolNames = result.tools
                                .map((t: any) => typeof t === 'string' ? t : t.name)
                                .filter(Boolean);
                            if (toolNames.length > 0) {
                                cache.recordDiscovery(result.query, toolNames);
                            }
                        }
                    } catch {
                        // Not JSON or not a tool.search result, ignore
                    }
                }
            }
        }

        return cache;
    }

    /**
     * Clear cache (call when starting a new conversation).
     */
    clear(): void {
        this.discoveredTools.clear();
        this.searchHistory = [];
    }

    /**
     * Merge another cache into this one.
     * Useful for combining caches from different sources.
     */
    merge(other: ToolDiscoveryCache): void {
        for (const tool of other.getDiscoveredTools()) {
            this.discoveredTools.add(tool);
        }
        this.searchHistory.push(...other.getSearchHistory());
    }
}
