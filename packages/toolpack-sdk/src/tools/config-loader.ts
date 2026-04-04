import * as fs from 'fs';
import * as path from 'path';
import { ToolsConfig, DEFAULT_TOOLS_CONFIG } from "./types.js";
import { logDebug } from '../providers/provider-logger.js';
import { McpToolsConfig } from './mcp-tools/index.js';

const CONFIG_FILENAME = 'toolpack.config.json';

export interface FullConfig {
    tools?: Partial<ToolsConfig>;
    logging?: any;
    systemPrompt?: string;
    disableBaseContext?: boolean;
    baseContext?: boolean;
    modeOverrides?: Record<string, any>;
    mcp?: McpToolsConfig;
}

/**
 * Load the full config from toolpack.config.json.
 * Returns the entire parsed config object.
 */
export function loadFullConfig(basePath?: string): FullConfig {
    const configPath = resolveConfigPath(basePath);

    if (!fs.existsSync(configPath)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/**
 * Load tools config from toolpack.config.json (tools section).
 * Falls back to defaults if the file doesn't exist or tools section is missing.
 */
export function loadToolsConfig(basePath?: string): ToolsConfig {
    const fullConfig = loadFullConfig(basePath);
    // Read from tools section, or fall back to root-level for backward compat
    const mergedConfig = mergeWithDefaults(fullConfig.tools || fullConfig as any);
    logDebug(JSON.stringify(mergedConfig ?? {}));
    return mergedConfig;
}

/**
 * Save tools config to toolpack.config.json (tools section).
 */
export function saveToolsConfig(config: ToolsConfig, basePath?: string): void {
    const configPath = resolveConfigPath(basePath);

    let existingConfig: any = {};
    try {
        if (fs.existsSync(configPath)) {
            existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    } catch {
        existingConfig = {};
    }

    // Write to tools section, preserving other config sections
    existingConfig.tools = config;
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 4), 'utf-8');
}

/**
 * Merge a partial config with defaults and inject environment variables.
 */
function mergeWithDefaults(partial: Partial<ToolsConfig>): ToolsConfig {
    // Merge additionalConfigurations with env variables
    const additionalConfigurations = partial.additionalConfigurations || {};
    
    // Inject webSearch API keys from environment variables if not already set
    if (!additionalConfigurations.webSearch) {
        additionalConfigurations.webSearch = {};
    }
    
    // Priority: config file > environment variables
    if (!additionalConfigurations.webSearch.tavilyApiKey && process.env.TOOLPACK_TAVILY_API_KEY) {
        additionalConfigurations.webSearch.tavilyApiKey = process.env.TOOLPACK_TAVILY_API_KEY;
    }
    
    if (!additionalConfigurations.webSearch.braveApiKey && process.env.TOOLPACK_BRAVE_API_KEY) {
        additionalConfigurations.webSearch.braveApiKey = process.env.TOOLPACK_BRAVE_API_KEY;
    }

    return {
        enabled: partial.enabled ?? DEFAULT_TOOLS_CONFIG.enabled,
        autoExecute: partial.autoExecute ?? DEFAULT_TOOLS_CONFIG.autoExecute,
        maxToolRounds: partial.maxToolRounds ?? DEFAULT_TOOLS_CONFIG.maxToolRounds,
        toolChoicePolicy: partial.toolChoicePolicy ?? DEFAULT_TOOLS_CONFIG.toolChoicePolicy,
        resultMaxChars: partial.resultMaxChars ?? DEFAULT_TOOLS_CONFIG.resultMaxChars,
        intelligentToolDetection: partial.intelligentToolDetection,
        enabledTools: partial.enabledTools ?? DEFAULT_TOOLS_CONFIG.enabledTools,
        enabledToolCategories: partial.enabledToolCategories ?? DEFAULT_TOOLS_CONFIG.enabledToolCategories,
        toolSearch: partial.toolSearch ?? DEFAULT_TOOLS_CONFIG.toolSearch,
        additionalConfigurations,
    };
}

function resolveConfigPath(basePathOrFilePath?: string): string {
    if (basePathOrFilePath) {
        // If the path ends with .json, assume it's a direct file path
        if (basePathOrFilePath.endsWith('.json')) {
            return path.resolve(basePathOrFilePath);
        }
        // Otherwise treat it as a directory base path
        return path.resolve(basePathOrFilePath, CONFIG_FILENAME);
    }
    
    // Default to cwd
    return path.resolve(process.cwd(), CONFIG_FILENAME);
}
