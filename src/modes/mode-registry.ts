import { ModeConfig } from './mode-types.js';
import { BUILT_IN_MODES, DEFAULT_MODE_NAME } from './built-in-modes.js';

/**
 * Central registry for AI agent modes (built-in + custom).
 * Handles registration, lookup, cycling, and defaults.
 */
export class ModeRegistry {
    private modes: Map<string, ModeConfig> = new Map();
    private orderedNames: string[] = [];

    constructor() {
        // Register all built-in modes in order
        for (const mode of BUILT_IN_MODES) {
            this.register(mode);
        }
    }

    /**
     * Register a mode (built-in or custom).
     * If a mode with the same name already exists, it is replaced.
     */
    register(mode: ModeConfig): void {
        // Validate required fields
        if (!mode.name || typeof mode.name !== 'string') {
            throw new Error('ModeConfig.name is required and must be a non-empty string');
        }
        if (!mode.displayName || typeof mode.displayName !== 'string') {
            throw new Error('ModeConfig.displayName is required and must be a non-empty string');
        }
        if (typeof mode.systemPrompt !== 'string') {
            throw new Error('ModeConfig.systemPrompt must be a string (can be empty for passthrough)');
        }
        if (mode.blockAllTools !== undefined && typeof mode.blockAllTools !== 'boolean') {
            throw new Error('ModeConfig.blockAllTools must be a boolean');
        }

        // Validate array fields
        const arrayFields = ['allowedToolCategories', 'blockedToolCategories', 'allowedTools', 'blockedTools'] as const;
        for (const field of arrayFields) {
            if (mode[field] !== undefined && !Array.isArray(mode[field])) {
                throw new Error(`ModeConfig.${field} must be an array`);
            }
        }

        const existed = this.modes.has(mode.name);
        this.modes.set(mode.name, mode);
        if (!existed) {
            this.orderedNames.push(mode.name);
        }
    }

    /**
     * Get a mode by name.
     */
    get(name: string): ModeConfig | undefined {
        return this.modes.get(name);
    }

    /**
     * Check if a mode exists.
     */
    has(name: string): boolean {
        return this.modes.has(name);
    }

    /**
     * Get all registered modes in cycle order.
     */
    getAll(): ModeConfig[] {
        const result: ModeConfig[] = [];
        for (const name of this.orderedNames) {
            const mode = this.modes.get(name);
            if (mode) {
                result.push(mode);
            }
        }
        return result;
    }

    /**
     * Get all registered mode names in cycle order.
     */
    getNames(): string[] {
        return [...this.orderedNames];
    }

    /**
     * Get the default mode.
     */
    getDefault(): ModeConfig {
        const mode = this.modes.get(DEFAULT_MODE_NAME);
        if (!mode) {
            throw new Error(`Default mode "${DEFAULT_MODE_NAME}" not found in registry`);
        }
        return mode;
    }

    /**
     * Get the next mode in cycle order after the given mode name.
     * Wraps around to the first mode after the last.
     */
    getNext(currentName: string): ModeConfig {
        const idx = this.orderedNames.indexOf(currentName);
        const nextIdx = idx === -1 ? 0 : (idx + 1) % this.orderedNames.length;
        const nextName = this.orderedNames[nextIdx];
        const mode = this.modes.get(nextName);
        if (!mode) {
            throw new Error(`Mode "${nextName}" not found in registry`);
        }
        return mode;
    }

    /**
     * Get the total number of registered modes.
     */
    get size(): number {
        return this.modes.size;
    }

    /**
     * Remove a mode by name.
     * Cannot remove built-in modes.
     */
    remove(name: string): boolean {
        const isBuiltIn = BUILT_IN_MODES.some(m => m.name === name);
        if (isBuiltIn) {
            return false;
        }
        const deleted = this.modes.delete(name);
        if (deleted) {
            this.orderedNames = this.orderedNames.filter(n => n !== name);
        }
        return deleted;
    }
}
