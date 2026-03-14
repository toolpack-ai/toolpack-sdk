import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const TOOLPACK_DIR_NAME = '.toolpack';
export const CONFIG_DIR_NAME = 'config';
export const CONFIG_FILE_NAME = 'toolpack.config.json';

/**
 * Returns the path to the user's home directory.
 */
export function getUserHomeDir(): string {
    return os.homedir();
}

/**
 * Returns the path to the global ~/.toolpack directory.
 */
export function getGlobalToolpackDir(): string {
    return path.join(getUserHomeDir(), TOOLPACK_DIR_NAME);
}

/**
 * Returns the path to the global ~/.toolpack/config directory.
 */
export function getGlobalConfigDir(): string {
    return path.join(getGlobalToolpackDir(), CONFIG_DIR_NAME);
}

/**
 * Returns the path to the global ~/.toolpack/config/toolpack.config.json file.
 */
export function getGlobalConfigPath(): string {
    return path.join(getGlobalConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Returns the path to the local workspace's .toolpack directory.
 */
export function getLocalToolpackDir(workspacePath: string = process.cwd()): string {
    return path.join(workspacePath, TOOLPACK_DIR_NAME);
}

/**
 * Returns the path to the local workspace's .toolpack/config directory.
 */
export function getLocalConfigDir(workspacePath: string = process.cwd()): string {
    return path.join(getLocalToolpackDir(workspacePath), CONFIG_DIR_NAME);
}

/**
 * Returns the path to the local workspace's .toolpack/config/toolpack.config.json file.
 */
export function getLocalConfigPath(workspacePath: string = process.cwd()): string {
    return path.join(getLocalConfigDir(workspacePath), CONFIG_FILE_NAME);
}

/**
 * Ensures the global ~/.toolpack/config directory exists.
 */
export function ensureGlobalConfigDir(): void {
    const configDir = getGlobalConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
}

/**
 * Ensures the local workspace's .toolpack/config directory exists.
 */
export function ensureLocalConfigDir(workspacePath: string = process.cwd()): void {
    const configDir = getLocalConfigDir(workspacePath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
}
