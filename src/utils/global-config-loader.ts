import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILENAME = 'toolpack.config.json';

/**
 * Global configuration interface.
 * Loaded from toolpack.config.json at the project root.
 */
export interface GlobalConfig {
    fastAIModels?: Record<string, string>;
}

/**
 * Default fast AI models for intelligent tool filtering and detection.
 */
const DEFAULT_FAST_AI_MODELS: Record<string, string> = {
    openai: 'gpt-4.1-mini',
    anthropic: 'claude-3-haiku-20240307',
    gemini: 'gemini-2.0-flash',
};

/**
 * Load global config from toolpack.config.json.
 * Falls back to defaults if the file doesn't exist or fastAIModels is missing.
 */
export function loadGlobalConfig(basePathOrFilePath?: string): GlobalConfig {
    const configPath = resolveConfigPath(basePathOrFilePath);

    if (!fs.existsSync(configPath)) {
        return { fastAIModels: DEFAULT_FAST_AI_MODELS };
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);

        return {
            fastAIModels: parsed.fastAIModels || DEFAULT_FAST_AI_MODELS,
        };
    } catch {
        return { fastAIModels: DEFAULT_FAST_AI_MODELS };
    }
}

/**
 * Resolve the path to toolpack.config.json.
 */
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
