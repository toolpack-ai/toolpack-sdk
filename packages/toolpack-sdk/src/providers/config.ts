import * as fs from 'fs';
import * as path from 'path';
import { ModeConfig } from '../modes/mode-types.js';
import { ContextWindowConfig } from '../types/index.js';
import { SDKError } from '../errors/index.js';

const CONFIG_FILENAME = 'toolpack.config.json';

// Simple file lock for config writes to prevent race conditions
const configLocks = new Map<string, Promise<void>>();

async function acquireConfigLock(configPath: string): Promise<() => void> {
    while (configLocks.has(configPath)) {
        await configLocks.get(configPath);
    }
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
        release = resolve;
    });
    configLocks.set(configPath, lockPromise);
    return () => {
        configLocks.delete(configPath);
        release!();
    };
}

// ============================================================================
// Types
// ============================================================================

export type ConfirmationLevel = 'high' | 'medium';

export interface OllamaModelConfig {
    /** Model name as used by Ollama, e.g. 'llama3', 'phi3:mini' */
    model: string;
    /** Display label for the UI */
    label?: string;
}

export interface HitlConfig {
    /** Master switch. Default: true */
    enabled?: boolean;
    /** Confirmation mode. Default: 'all' */
    confirmationMode?: 'off' | 'high-only' | 'all';
    /** Bypass rules for specific tools, categories, or risk levels */
    bypass?: {
        /** Tool keys to bypass (e.g. ["exec.run", "fs.delete_file"]) */
        tools?: string[];
        /** Categories to bypass (e.g. ["exec-tools"]) */
        categories?: string[];
        /** Risk levels to bypass (e.g. ["medium"]) */
        levels?: ConfirmationLevel[];
    };
}

export interface ToolpackConfig {
    /** Optional override system prompt for the AIClient */
    systemPrompt?: string;
    /** @deprecated Use `baseContext: false` instead. Legacy: disable auto-injected base agent context. */
    disableBaseContext?: boolean;
    /** Base agent context configuration. `false` disables it entirely. */
    baseContext?: { includeWorkingDirectory?: boolean; includeToolCategories?: boolean; custom?: string } | false;
    /** Optional system prompt overrides for specific modes */
    modeOverrides?: Record<string, Partial<ModeConfig>>;

    /** Ollama provider configuration */
    ollama?: {
        /** Base URL for the Ollama API. Default: http://localhost:11434 */
        baseUrl?: string;
        /** List of Ollama models available as providers */
        models?: OllamaModelConfig[];
    };

    /** Logging configuration. File logging is opt-in (disabled by default). */
    logging?: {
        /** Enable file logging. Default: false */
        enabled?: boolean;
        /** Log file path. Default: 'toolpack-sdk.log' in CWD */
        filePath?: string;
    };

    /** Human-in-the-loop configuration for tool confirmation */
    hitl?: HitlConfig;

    /** Context window management configuration for automatic conversation pruning/summarization */
    contextWindow?: ContextWindowConfig;
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Auto-discover the config file path.
 */
export function discoverConfigPath(explicitPath?: string): string | null {
    if (explicitPath) {
        if (fs.existsSync(explicitPath)) return explicitPath;
    }

    const cwdPath = path.join(process.cwd(), CONFIG_FILENAME);
    if (fs.existsSync(cwdPath)) return cwdPath;

    return null;
}

// ============================================================================
// Load
// ============================================================================

/**
 * Load and parse the config file. Returns null if not found or invalid.
 */
export function loadConfig(configPath: string | null): ToolpackConfig | null {
    if (!configPath) return null;

    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as ToolpackConfig;
        return parsed;
    } catch {
        return null;
    }
}

// ============================================================================
// Cached Config Reader
// ============================================================================

let _cachedConfig: ToolpackConfig | null = null;

export function getToolpackConfig(configPath?: string): ToolpackConfig {
    if (_cachedConfig) return _cachedConfig;

    const resolved = configPath || discoverConfigPath();
    _cachedConfig = loadConfig(resolved) || {};
    return _cachedConfig;
}

export function reloadToolpackConfig(): void {
    _cachedConfig = null;
}

// ============================================================================
// Ollama Config Helpers
// ============================================================================

export interface OllamaProviderEntry {
    /** Provider type key, e.g. 'ollama-llama3' */
    type: string;
    /** Ollama model name, e.g. 'llama3' */
    model: string;
    /** Display label */
    label: string;
}

export function getOllamaProviderEntries(configPath?: string): OllamaProviderEntry[] {
    const config = getToolpackConfig(configPath);
    const models = config.ollama?.models || [];

    return models.map(m => ({
        type: `ollama-${m.model.replace(/[:.]/g, '-')}`,
        model: m.model,
        label: m.label || m.model,
    }));
}

export function getOllamaBaseUrl(configPath?: string): string {
    const config = getToolpackConfig(configPath);
    return config.ollama?.baseUrl || 'http://localhost:11434';
}

// ============================================================================
// HITL Bypass Helpers
// ============================================================================

export type BypassRuleType = 'tool' | 'category' | 'level';

export interface AddBypassRuleOptions {
    /** Type of bypass rule */
    type: BypassRuleType;
    /** Value to bypass (tool name, category, or level) */
    value: string;
    /** Optional config path. If not provided, uses local config or creates one */
    configPath?: string;
}

/**
 * Add a bypass rule to the HITL config and persist it to the config file.
 * This is useful for implementing "Allow Always" functionality.
 * 
 * @example
 * // Bypass a specific tool
 * await addBypassRule({ type: 'tool', value: 'fs.write_file' });
 * 
 * // Bypass all medium-risk tools
 * await addBypassRule({ type: 'level', value: 'medium' });
 * 
 * // Bypass an entire category
 * await addBypassRule({ type: 'category', value: 'exec-tools' });
 */
export async function addBypassRule(options: AddBypassRuleOptions): Promise<void> {
    const { type, value, configPath: explicitPath } = options;

    // Determine config file path
    let configPath = explicitPath || discoverConfigPath();

    // If no config exists, create one in CWD
    if (!configPath) {
        configPath = path.join(process.cwd(), CONFIG_FILENAME);
    }

    // Acquire lock to prevent concurrent writes
    const release = await acquireConfigLock(configPath);

    try {
        // Load existing config or create empty one
        const config: ToolpackConfig = loadConfig(configPath) || {};

        // Ensure hitl config exists
        if (!config.hitl) {
            config.hitl = {};
        }

        // Ensure bypass section exists
        if (!config.hitl.bypass) {
            config.hitl.bypass = {};
        }

        // Add the bypass rule based on type
        switch (type) {
            case 'tool':
                if (!config.hitl.bypass.tools) {
                    config.hitl.bypass.tools = [];
                }
                if (!config.hitl.bypass.tools.includes(value)) {
                    config.hitl.bypass.tools.push(value);
                }
                break;
            case 'category':
                if (!config.hitl.bypass.categories) {
                    config.hitl.bypass.categories = [];
                }
                if (!config.hitl.bypass.categories.includes(value)) {
                    config.hitl.bypass.categories.push(value);
                }
                break;
            case 'level': {
                if (!config.hitl.bypass.levels) {
                    config.hitl.bypass.levels = [];
                }
                const level = value as ConfirmationLevel;
                if (!config.hitl.bypass.levels.includes(level)) {
                    config.hitl.bypass.levels.push(level);
                }
                break;
            }
        }

        // Write config back to file
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');
        } catch (error) {
            throw new SDKError(
                `Failed to write bypass rule to config file: ${error instanceof Error ? error.message : String(error)}`,
                'CONFIG_WRITE_ERROR'
            );
        }

        // Clear cache so next read gets updated config
        reloadToolpackConfig();
    } finally {
        // Always release the lock
        release();
    }
}

/**
 * Remove a bypass rule from the HITL config.
 * 
 * @example
 * await removeBypassRule({ type: 'tool', value: 'fs.write_file' });
 */
export async function removeBypassRule(options: AddBypassRuleOptions): Promise<void> {
    const { type, value, configPath: explicitPath } = options;

    // Determine config file path
    const configPath = explicitPath || discoverConfigPath();
    if (!configPath) return; // No config to modify

    // Acquire lock to prevent concurrent writes
    const release = await acquireConfigLock(configPath);

    try {
        // Load existing config
        const config = loadConfig(configPath);
        if (!config?.hitl?.bypass) return; // No bypass rules to remove

        // Remove the bypass rule based on type
        switch (type) {
            case 'tool':
                if (config.hitl.bypass.tools) {
                    config.hitl.bypass.tools = config.hitl.bypass.tools.filter(t => t !== value);
                }
                break;
            case 'category':
                if (config.hitl.bypass.categories) {
                    config.hitl.bypass.categories = config.hitl.bypass.categories.filter(c => c !== value);
                }
                break;
            case 'level':
                if (config.hitl.bypass.levels) {
                    config.hitl.bypass.levels = config.hitl.bypass.levels.filter(l => l !== value);
                }
                break;
        }

        // Write config back to file
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');
        } catch (error) {
            throw new SDKError(
                `Failed to remove bypass rule from config file: ${error instanceof Error ? error.message : String(error)}`,
                'CONFIG_WRITE_ERROR'
            );
        }

        // Clear cache
        reloadToolpackConfig();
    } finally {
        // Always release the lock
        release();
    }
}
