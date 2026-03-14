/**
 * Core type definitions for the Tool Calling System.
 */

// ── Tool Definition ────────────────────────────────────────────

export interface ToolParameterProperty {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'integer';
    description?: string;
    enum?: string[];
    default?: any;
    items?: ToolParameterProperty;
    properties?: Record<string, ToolParameterProperty>;
    required?: string[];
}

export interface ToolParameters {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
}

export interface ToolContext {
    /** Absolute path to the workspace/project root */
    workspaceRoot: string;
    /** Tool-specific config from toolpack.config.json additionalConfigurations */
    config: Record<string, any>;
    /** Scoped logger — writes to toolpack-sdk.log */
    log: (message: string) => void;
}

export interface ToolDefinition {
    name: string;
    displayName: string;
    description: string;
    parameters: ToolParameters;
    category: string;
    execute: (args: Record<string, any>, ctx?: ToolContext) => Promise<string>;
}

/**
 * Schema-only version of ToolDefinition (no execute function).
 * Used for serialization and sending to AI providers.
 */
export interface ToolSchema {
    name: string;
    displayName: string;
    description: string;
    parameters: ToolParameters;
    category: string;
}

// ── Tool Project ──────────────────────────────────────────────

export interface ToolProjectManifest {
    key: string;
    name: string;
    displayName: string;
    version: string;
    description: string;
    author?: string;
    repository?: string;
    tools: string[];
    category: string;
}

export interface ToolProjectDependencies {
    [packageName: string]: string; // package name → semver range
}

export interface ToolProject {
    manifest: ToolProjectManifest;
    tools: ToolDefinition[];
    dependencies?: ToolProjectDependencies;
}

// ── Tool Call / Result ─────────────────────────────────────────

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface ToolResult {
    tool_call_id: string;
    name: string;
    result: string;
    error?: string;
}

// ── Tool Category ──────────────────────────────────────────────

export interface ToolCategory {
    name: string;
    description: string;
    tools: string[];
}

// ── Tools Config (mirrors toolpack.config.tools.json) ─────────

/**
 * @deprecated This interface is deprecated and will be removed in a future version.
 */
export interface IntelligentToolDetectionConfig {
    enabled: boolean;
    maxFollowUpMessages: number; // How many messages after a tool call to check (default: 5)
}

/**
 * Tool Search Configuration (Anthropic-style on-demand tool discovery)
 */
export interface ToolSearchConfig {
    enabled: boolean;                  // Enable tool search mode
    alwaysLoadedTools: string[];       // Tools to always include (never defer)
    alwaysLoadedCategories: string[];  // Categories to always include
    searchResultLimit: number;         // Max tools per search (default: 5)
    cacheDiscoveredTools: boolean;     // Auto-cache in conversation (default: true)
}

export interface ToolsConfig {
    enabled: boolean;
    autoExecute: boolean;
    maxToolRounds: number;
    toolChoicePolicy?: 'auto' | 'required' | 'required_for_actions';
    /**
     * @deprecated This feature is deprecated and will be removed in a future version. Use `toolSearch` instead.
     */
    intelligentToolDetection?: IntelligentToolDetectionConfig;
    enabledTools: string[];
    enabledToolCategories: string[];
    toolSearch?: ToolSearchConfig;     // NEW: Tool search configuration
    additionalConfigurations?: {
        [key: string]: any;
    };
}

// ── Default Config ─────────────────────────────────────────────

/**
 * Default Tool Search Configuration
 */
export const DEFAULT_TOOL_SEARCH_CONFIG: ToolSearchConfig = {
    enabled: false,                    // Opt-in (backward compatible)
    alwaysLoadedTools: [],             // User configures their top 3-5
    alwaysLoadedCategories: [],        // Or entire categories
    searchResultLimit: 5,              // Anthropic returns 3-5
    cacheDiscoveredTools: true,        // Industry standard
};

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
    enabled: true,
    autoExecute: true,
    maxToolRounds: 5,
    toolChoicePolicy: 'auto',
    enabledTools: [],
    enabledToolCategories: [],
    toolSearch: DEFAULT_TOOL_SEARCH_CONFIG,
};
