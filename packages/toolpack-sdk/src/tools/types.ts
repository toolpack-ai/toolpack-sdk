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
    additionalProperties?: ToolParameterProperty | boolean;
    required?: string[];
}

export interface ToolParameters {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
}

/**
 * Per-tenant tool credentials passed via toolsConfig.additionalConfigurations.credentials.
 * Each field is a programmatic override; tools fall back to the corresponding
 * env var when the field is absent.
 */
export interface ToolpackCredentials {
    /** GitHub personal access token. Fallback: GITHUB_PAT */
    githubPat?: string;
    /** GitHub App ID. Fallback: GITHUB_APP_ID */
    githubAppId?: string;
    /** GitHub App private key (PEM). Fallback: GITHUB_APP_PRIVATE_KEY */
    githubAppPrivateKey?: string;
    /** Slack bot token. Fallback: TOOLPACK_SLACK_BOT_TOKEN */
    slackBotToken?: string;
    /** Netlify auth token. Fallback: NETLIFY_AUTH_TOKEN */
    netlifyAuthToken?: string;
}

export interface ToolContext {
    /** Absolute path to the workspace/project root */
    workspaceRoot: string;
    /**
     * Tool-specific config from toolsConfig.additionalConfigurations.
     * Includes credentials (ctx.config.credentials) and per-tool settings
     * (ctx.config.gitClone, ctx.config.webSearch, etc.).
     */
    config: Record<string, any>;
    /** Scoped logger — writes to toolpack-sdk.log */
    log: (message: string) => void;
    // ── Scoped per-Toolpack registries (§2.1, §2.4) ──────────────
    // Present when built-in tools are loaded via ToolRegistry.loadBuiltIn().
    // Tools fall back to the module-level default when absent (single-tenant use).
    /** Per-tenant background-process registry (exec-tools). */
    processRegistry?: import('./exec-tools/process-registry.js').ProcessRegistry;
    /** Per-tenant GitHub App installation-token cache (github-tools). */
    githubTokenStore?: import('./github-tools/auth.js').GithubTokenStore;
}

// ── Tool Annotations (MCP) ────────────────────────────────────

/**
 * Hints about tool behaviour sent to MCP clients in tools/list.
 * All fields are optional — clients use them for safety UX (e.g. confirmation
 * dialogs before destructive actions) but must not rely on them for security.
 *
 * MCP spec defaults when annotations are omitted entirely:
 *   readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false
 *
 * The MCP server auto-derives annotations when this field is not set:
 *   - confirmation present → { destructiveHint: true }
 *   - neither set          → annotations omitted (MCP spec defaults apply)
 * Set explicitly to override.
 */
export interface ToolAnnotations {
    /**
     * Tool only reads data — never writes, calls APIs, or modifies state.
     * MCP spec default (when absent): false.
     * Set to true for pure read tools: fs.read_file, search, list-dir.
     */
    readOnlyHint?: boolean;
    /**
     * Tool may cause irreversible side-effects (delete, overwrite, deploy, send).
     * MCP spec default (when absent): true — clients assume worst case.
     * Set to false for safe write operations (e.g. create-if-not-exists).
     */
    destructiveHint?: boolean;
    /**
     * Calling the tool multiple times with the same args has no additional effect.
     * MCP spec default (when absent): false.
     * Set to true for idempotent operations.
     */
    idempotentHint?: boolean;
    /**
     * Tool may interact with external systems: web, APIs, databases, shell, filesystem.
     * MCP spec default (when absent): true.
     * Set to false only for purely in-process, local tools with no side-effects.
     */
    openWorldHint?: boolean;
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
    /**
     * MCP annotation hints describing tool behaviour to clients.
     * When omitted, the MCP server auto-derives from `confirmation`:
     *   - confirmation set  → { destructiveHint: true }
     *   - no confirmation   → annotations omitted (MCP spec defaults apply)
     * Set explicitly to override — particularly useful for marking read-only tools
     * (readOnlyHint: true) or idempotent tools (idempotentHint: true).
     */
    annotations?: ToolAnnotations;
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
    /** MCP annotation hints. See ToolAnnotations for details. */
    annotations?: ToolAnnotations;
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
