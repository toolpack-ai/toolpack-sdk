import * as fs from 'fs';
import * as path from 'path';
import { ModeConfig } from '../modes/mode-types.js';

const CONFIG_FILENAME = 'toolpack.config.json';

// ============================================================================
// Types
// ============================================================================

export interface OllamaModelConfig {
    /** Model name as used by Ollama, e.g. 'llama3', 'phi3:mini' */
    model: string;
    /** Display label for the UI */
    label?: string;
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
