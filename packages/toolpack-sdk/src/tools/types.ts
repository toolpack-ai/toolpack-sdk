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

// ── Tool Confirmation (HITL) ─────────────────────────────────

export type ConfirmationLevel = 'high' | 'medium';

export interface ToolConfirmation {
    level: ConfirmationLevel;
    reason: string;      // Shown to user: "This will permanently delete the file."
    showArgs?: string[]; // Which args to surface in the prompt (e.g. ['path', 'table'])
}

export interface ToolDefinition {
    name: string;
    displayName: string;
    description: string;
    parameters: ToolParameters;
    category: string;
    execute: (args: Record<string, any>, ctx?: ToolContext) => Promise<string>;
    /** 
     * Whether this tool should be cached after discovery via tool.search.
     * If false, the tool must be re-discovered each time it's needed.
     * Default: true
     */
    cacheable?: boolean;
    /**
     * Human-in-the-loop confirmation configuration.
     * If set, the tool will require user confirmation before execution.
     * Note: Only effective when onToolConfirm callback is provided to AIClient.
     */
    confirmation?: ToolConfirmation;
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
    /** 
     * Whether this tool should be cached after discovery via tool.search.
     * If false, the tool must be re-discovered each time it's needed.
     * Default: true
     */
    cacheable?: boolean;
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
    resultMaxChars?: number;
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
    resultMaxChars: 20_000,
    enabledTools: [],
    enabledToolCategories: [],
    toolSearch: DEFAULT_TOOL_SEARCH_CONFIG,
};
