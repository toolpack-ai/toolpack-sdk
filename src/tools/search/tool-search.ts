/**
 * Tool Search Meta-Tool
 * 
 * A special built-in tool that enables AI models to dynamically discover
 * tools on-demand, following Anthropic's Tool Search pattern.
 * 
 * This tool is NEVER deferred - it's always loaded so the AI can search
 * for other tools when needed.
 */

import { ToolDefinition, ToolSchema } from '../types.js';

// ── Tool Search Definition ───────────────────────────────────────────────────

export const TOOL_SEARCH_NAME = 'tool.search';

export const toolSearchDefinition: ToolDefinition = {
    name: TOOL_SEARCH_NAME,
    displayName: 'Search Tools',
    category: 'meta',
    description: `Search for available tools by keyword or natural language query.
Use this to discover tools before using them.
Examples: "file operations", "web scraping", "run command", "http request"

Returns a list of matching tools with their names, descriptions, and parameters.
After discovering tools, you can call them directly by name.`,
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Natural language search query (e.g., "read files", "web scraping", "execute shell commands")',
            },
            category: {
                type: 'string',
                description: 'Optional: filter by category',
                enum: ['filesystem', 'network', 'execution', 'system', 'meta'],
            },
        },
        required: ['query'],
    },
    execute: async () => {
        // This is a placeholder - actual execution is handled by AIClient
        // which has access to the BM25SearchEngine
        throw new Error('tool.search execution must be handled by AIClient');
    },
};

/**
 * Get the tool.search schema (without execute function).
 */
export function getToolSearchSchema(): ToolSchema {
    return {
        name: toolSearchDefinition.name,
        displayName: toolSearchDefinition.displayName,
        description: toolSearchDefinition.description,
        parameters: toolSearchDefinition.parameters,
        category: toolSearchDefinition.category,
    };
}

/**
 * Check if a tool name is the tool.search meta-tool.
 */
export function isToolSearchTool(toolName: string): boolean {
    return toolName === TOOL_SEARCH_NAME;
}
