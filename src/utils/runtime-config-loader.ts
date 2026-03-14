import * as fs from 'fs';
import * as path from 'path';
import { getGlobalConfigPath, getLocalConfigPath, ensureGlobalConfigDir } from './home-config.js';
import { ToolpackConfig } from '../providers/config.js';
import { discoverConfigPath } from '../providers/config.js';

export interface RuntimeConfigStatus {
    isFirstRun: boolean;
    activeConfigPath: string | null;
    configSource: 'local' | 'global' | 'base' | 'default';
}

/**
 * Deep merges two objects. Arrays are overwritten.
 */
function deepMerge<T extends Record<string, any>>(target: T, source: T): T {
    if (!source) return target;
    if (!target) return source;

    const result = { ...target } as Record<string, any>;

    for (const key of Object.keys(source)) {
        if (source[key] instanceof Array) {
            result[key] = source[key];
        } else if (source[key] instanceof Object && key in target) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }

    return result as T;
}

/**
 * Loads a configuration file from the given path if it exists.
 */
function loadConfigFile(configPath: string): ToolpackConfig | null {
    if (!fs.existsSync(configPath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw) as ToolpackConfig;
    } catch {
        return null;
    }
}

/**
 * Loads the runtime configuration by merging base, global, and local configurations.
 * Priority: Workspace Local (.toolpack/config) > Global (~/.toolpack/config) > SDK Base (toolpack.config.json)
 */
export function loadRuntimeConfig(workspacePath: string = process.cwd()): ToolpackConfig {
    const basePath = path.join(workspacePath, 'toolpack.config.json');
    const globalPath = getGlobalConfigPath();
    const localPath = getLocalConfigPath(workspacePath);

    const baseConfig = loadConfigFile(basePath) || {};
    const globalConfig = loadConfigFile(globalPath) || {};
    const localConfig = loadConfigFile(localPath) || {};

    // Merge in order of priority: base -> global -> local
    let merged = deepMerge(baseConfig, globalConfig);
    merged = deepMerge(merged, localConfig);
    
    return merged as ToolpackConfig;
}

/**
 * Helper to check the status of the configuration.
 */
export function getRuntimeConfigStatus(workspacePath: string = process.cwd()): RuntimeConfigStatus {
    const basePath = path.join(workspacePath, 'toolpack.config.json');
    const globalPath = getGlobalConfigPath();
    const localPath = getLocalConfigPath(workspacePath);

    const isFirstRun = !fs.existsSync(globalPath);
    let activeConfigPath: string | null = null;
    let configSource: 'local' | 'global' | 'base' | 'default' = 'default';

    if (fs.existsSync(localPath)) {
        activeConfigPath = localPath;
        configSource = 'local';
    } else if (fs.existsSync(globalPath)) {
        activeConfigPath = globalPath;
        configSource = 'global';
    } else if (fs.existsSync(basePath)) {
        activeConfigPath = basePath;
        configSource = 'base';
    }

    return {
        isFirstRun,
        activeConfigPath,
        configSource,
    };
}

/**
 * Initializes the global configuration if it doesn't exist.
 * This is typically called on the first run of the CLI.
 * It copies the build-time config (if found in the current directory) to the global config path.
 */
export function initializeGlobalConfigIfFirstRun(workspacePath: string = process.cwd()): void {
    const globalPath = getGlobalConfigPath();

    if (!fs.existsSync(globalPath)) {
        ensureGlobalConfigDir();

        // Try to find a template config in the workspace to copy from
        let sourceConfigPath: string | null = null;
        
        // 1. Try local workspace config (.toolpack/config/toolpack.config.json)
        const localPath = getLocalConfigPath(workspacePath);
        if (fs.existsSync(localPath)) {
            sourceConfigPath = localPath;
        } 
        // 2. Try SDK base config (toolpack.config.json in root)
        else {
            const basePath = path.join(workspacePath, 'toolpack.config.json');
            if (fs.existsSync(basePath)) {
                sourceConfigPath = basePath;
            } else {
                // 3. Try discover (looks in cwd)
                const discoveredPath = discoverConfigPath();
                if (discoveredPath && fs.existsSync(discoveredPath)) {
                    sourceConfigPath = discoveredPath;
                }
            }
        }
        
        let initialConfig = {};
        if (sourceConfigPath) {
            try {
                const raw = fs.readFileSync(sourceConfigPath, 'utf-8');
                initialConfig = JSON.parse(raw);
            } catch {
                // Ignore errors reading source config, fall back to empty object
            }
        }

        // Write to global path
        fs.writeFileSync(globalPath, JSON.stringify(initialConfig, null, 4), 'utf-8');
    }
}
