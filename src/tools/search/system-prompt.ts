/**
 * System Prompt Generator for Tool Search
 * 
 * Generates system prompt sections describing available tool categories.
 * This helps the AI know what's available before searching.
 * 
 * OpenAI Best Practice:
 * "Add a system prompt section describing available tool categories"
 */

import { ToolRegistry } from '../registry.js';

// ── Category Descriptions ────────────────────────────────────────────────────

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    filesystem: 'File operations (read, write, delete, list, search files)',
    network: 'HTTP requests and web scraping (GET, POST, fetch pages, extract data)',
    execution: 'Run shell commands and manage processes',
    system: 'System information, environment variables, disk usage',
    meta: 'Tool discovery and management',
};

// ── System Prompt Generator ──────────────────────────────────────────────────

/**
 * Generate a system prompt section describing available tool categories.
 * Include this in the system prompt when tool search is enabled.
 */
export function generateToolCategoriesPrompt(registry: ToolRegistry): string {
    const categories = registry.getCategories();
    
    if (categories.length === 0) {
        return 'No tools are currently available.';
    }

    const lines: string[] = [
        'You have access to tools in the following categories:',
        '',
    ];

    for (const category of categories) {
        const tools = registry.getByCategory(category);
        const count = tools.length;
        const desc = CATEGORY_DESCRIPTIONS[category] || category;
        lines.push(`- **${category}** (${count} tools): ${desc}`);
    }

    lines.push('');
    lines.push('Use `tool.search` to discover specific tools when needed.');
    lines.push('Example: tool.search({ query: "read file" }) to find file reading tools.');

    return lines.join('\n');
}

/**
 * Generate a compact tool categories summary (for token efficiency).
 */
export function generateCompactCategoriesPrompt(registry: ToolRegistry): string {
    const categories = registry.getCategories();
    
    if (categories.length === 0) {
        return '';
    }

    const parts: string[] = [];
    for (const category of categories) {
        const count = registry.getByCategory(category).length;
        parts.push(`${category}(${count})`);
    }

    return `Available tool categories: ${parts.join(', ')}. Use tool.search to discover tools.`;
}
