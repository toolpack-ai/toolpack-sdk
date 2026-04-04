import { ToolDefinition, ToolSchema, ToolsConfig } from "./types.js";
import { ToolRegistry } from './registry.js';
import { Message } from '../types/index.js';
import { ToolDiscoveryCache, getToolSearchSchema, TOOL_SEARCH_NAME } from './search/index.js';

/**
 * Resolves which tools to send to the AI based on the tools config.
 *
 * Modes:
 * 1. Tool Search Mode (toolSearch.enabled = true):
 *    - Send only tool.search + alwaysLoadedTools + discovered tools
 *    - AI discovers tools on-demand via tool.search
 *    - 85%+ token savings for large tool libraries
 *
 * 2. Legacy Mode (toolSearch.enabled = false):
 *    - Send all enabled tools upfront
 *    - Use enabledTools/enabledToolCategories for filtering
 */
export class ToolRouter {
    private discoveryCache: ToolDiscoveryCache = new ToolDiscoveryCache();

    /**
     * Resolve the final list of tool schemas to send to the main AI model.
     *
     * @param messages  The conversation messages (used for extracting discovered tools)
     * @param registry  The tool registry containing all registered tools
     * @param config    The tools config from toolpack.config.tools.json
     */
    async resolve(
        messages: Message[],
        registry: ToolRegistry,
        config: ToolsConfig,
    ): Promise<ToolSchema[]> {
        if (!config.enabled) {
            return [];
        }

        // Tool Search Mode (Industry-Standard)
        if (config.toolSearch?.enabled) {
            return this.resolveWithToolSearch(messages, registry, config);
        }

        // Legacy Mode (all tools upfront)
        return this.resolveLegacy(registry, config);
    }

    /**
     * Get the discovery cache (for AIClient to record discoveries).
     */
    getDiscoveryCache(): ToolDiscoveryCache {
        return this.discoveryCache;
    }

    /**
     * Clear the discovery cache (call when starting a new conversation).
     */
    clearDiscoveryCache(): void {
        this.discoveryCache.clear();
    }

    // ── Tool Search Mode ─────────────────────────────────────────────────────

    private resolveWithToolSearch(
        messages: Message[],
        registry: ToolRegistry,
        config: ToolsConfig
    ): ToolSchema[] {
        const schemas: ToolSchema[] = [];
        const seen = new Set<string>();

        // 1. Always include tool.search itself
        schemas.push(getToolSearchSchema());
        seen.add(TOOL_SEARCH_NAME);

        // 2. Always-loaded tools (user's top 3-5)
        const alwaysLoadedTools = config.toolSearch?.alwaysLoadedTools ?? [];
        for (const name of alwaysLoadedTools) {
            const tool = registry.get(name);
            if (tool && !seen.has(name)) {
                schemas.push(this.toSchema(tool));
                seen.add(name);
            }
        }

        // 3. Always-loaded categories
        const alwaysLoadedCategories = config.toolSearch?.alwaysLoadedCategories ?? [];
        for (const category of alwaysLoadedCategories) {
            for (const tool of registry.getByCategory(category)) {
                if (!seen.has(tool.name)) {
                    schemas.push(this.toSchema(tool));
                    seen.add(tool.name);
                }
            }
        }

        // 4. Previously discovered tools (auto-cached, respecting cacheable flag)
        if (config.toolSearch?.cacheDiscoveredTools !== false) {
            // Merge any discoveries from messages into existing cache (don't overwrite)
            const messageCache = ToolDiscoveryCache.fromMessages(messages);
            this.discoveryCache.merge(messageCache);
            
            const discovered = this.discoveryCache.getDiscoveredTools();

            for (const name of discovered) {
                const tool = registry.get(name);
                // Only cache tools where cacheable !== false (default is true)
                if (tool && !seen.has(name) && tool.cacheable !== false) {
                    schemas.push(this.toSchema(tool));
                    seen.add(name);
                }
            }
        }

        return schemas;
    }

    // ── Legacy Mode ──────────────────────────────────────────────────────────

    private resolveLegacy(
        registry: ToolRegistry,
        config: ToolsConfig
    ): ToolSchema[] {
        let candidates: ToolDefinition[];

        if (config.enabledTools.length === 0 && config.enabledToolCategories.length === 0) {
            // Empty arrays = all tools enabled
            candidates = registry.getEnabled();
        } else {
            // Non-empty = only specified tools/categories
            const fromNames = registry.getByNames(config.enabledTools);
            const fromCategories = registry.getByCategories(config.enabledToolCategories);

            // Deduplicate by name
            const seen = new Set<string>();
            candidates = [];
            for (const tool of [...fromNames, ...fromCategories]) {
                if (!seen.has(tool.name)) {
                    seen.add(tool.name);
                    candidates.push(tool);
                }
            }
        }

        return candidates.map(t => this.toSchema(t));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private toSchema(tool: ToolDefinition): ToolSchema {
        return {
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            parameters: tool.parameters,
            category: tool.category,
        };
    }
}
