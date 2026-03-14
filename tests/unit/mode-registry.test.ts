import { describe, it, expect } from 'vitest';
import { ModeRegistry } from '../../src/modes/mode-registry.js';
import { BUILT_IN_MODES, DEFAULT_MODE_NAME } from '../../src/modes/built-in-modes.js';
import { ModeConfig } from '../../src/modes/mode-types.js';

describe('ModeRegistry', () => {
    it('should register all built-in modes on construction', () => {
        const registry = new ModeRegistry();
        expect(registry.size).toBe(BUILT_IN_MODES.length);
        for (const mode of BUILT_IN_MODES) {
            expect(registry.has(mode.name)).toBe(true);
        }
    });

    it('should get a mode by name', () => {
        const registry = new ModeRegistry();
        const mode = registry.get(DEFAULT_MODE_NAME);
        expect(mode).toBeDefined();
        expect(mode?.name).toBe(DEFAULT_MODE_NAME);
    });

    it('should return undefined for unknown mode', () => {
        const registry = new ModeRegistry();
        expect(registry.get('nonexistent-mode')).toBeUndefined();
    });

    it('should report has() correctly', () => {
        const registry = new ModeRegistry();
        expect(registry.has(DEFAULT_MODE_NAME)).toBe(true);
        expect(registry.has('nonexistent-mode')).toBe(false);
    });

    it('should return all modes in registration order', () => {
        const registry = new ModeRegistry();
        const all = registry.getAll();
        expect(all).toHaveLength(BUILT_IN_MODES.length);
        for (let i = 0; i < BUILT_IN_MODES.length; i++) {
            expect(all[i]?.name).toBe(BUILT_IN_MODES[i]?.name);
        }
    });

    it('should return all names in cycle order', () => {
        const registry = new ModeRegistry();
        const names = registry.getNames();
        expect(names).toHaveLength(BUILT_IN_MODES.length);
        expect(names[0]).toBe(BUILT_IN_MODES[0]?.name);
    });

    it('should return the default mode', () => {
        const registry = new ModeRegistry();
        const defaultMode = registry.getDefault();
        expect(defaultMode.name).toBe(DEFAULT_MODE_NAME);
    });

    it('should cycle to the next mode', () => {
        const registry = new ModeRegistry();
        const names = registry.getNames();
        if (names.length < 2) return; // skip if only 1 mode

        const first = names[0];
        const second = names[1];
        if (!first || !second) return;

        const next = registry.getNext(first);
        expect(next.name).toBe(second);
    });

    it('should wrap around at end of cycle', () => {
        const registry = new ModeRegistry();
        const names = registry.getNames();
        const last = names[names.length - 1];
        const first = names[0];
        if (!last || !first) return;

        const next = registry.getNext(last);
        expect(next.name).toBe(first);
    });

    it('should return first mode when getNext is called with unknown name', () => {
        const registry = new ModeRegistry();
        const first = registry.getNames()[0];
        if (!first) return;

        const next = registry.getNext('unknown-mode-xyz');
        expect(next.name).toBe(first);
    });

    it('should register a custom mode', () => {
        const registry = new ModeRegistry();
        const custom: ModeConfig = {
            name: 'custom-test',
            displayName: 'Custom Test Mode',
            systemPrompt: 'You are a test mode.',
        };
        registry.register(custom);

        expect(registry.has('custom-test')).toBe(true);
        expect(registry.get('custom-test')).toEqual(custom);
        expect(registry.size).toBe(BUILT_IN_MODES.length + 1);
    });

    it('should replace an existing mode on re-register', () => {
        const registry = new ModeRegistry();
        const custom: ModeConfig = {
            name: 'custom-test',
            displayName: 'Custom Test Mode',
            systemPrompt: 'Version 1',
        };
        registry.register(custom);

        const updated: ModeConfig = {
            name: 'custom-test',
            displayName: 'Custom Test Mode Updated',
            systemPrompt: 'Version 2',
        };
        registry.register(updated);

        expect(registry.get('custom-test')?.displayName).toBe('Custom Test Mode Updated');
        // Size should NOT increase on replace
        expect(registry.size).toBe(BUILT_IN_MODES.length + 1);
    });

    it('should remove a custom mode', () => {
        const registry = new ModeRegistry();
        const custom: ModeConfig = {
            name: 'removable',
            displayName: 'Removable Mode',
            systemPrompt: 'Temporary.',
        };
        registry.register(custom);
        expect(registry.has('removable')).toBe(true);

        const removed = registry.remove('removable');
        expect(removed).toBe(true);
        expect(registry.has('removable')).toBe(false);
    });

    it('should refuse to remove a built-in mode', () => {
        const registry = new ModeRegistry();
        const removed = registry.remove(DEFAULT_MODE_NAME);
        expect(removed).toBe(false);
        expect(registry.has(DEFAULT_MODE_NAME)).toBe(true);
    });

    it('should return false when removing a non-existent mode', () => {
        const registry = new ModeRegistry();
        const removed = registry.remove('does-not-exist');
        expect(removed).toBe(false);
    });

    describe('validation', () => {
        it('should reject a mode without a name', () => {
            const registry = new ModeRegistry();
            expect(() => {
                registry.register({ displayName: 'Test', systemPrompt: 'Test' } as any);
            }).toThrowError(/ModeConfig.name is required/);
        });

        it('should reject a mode with a non-string name', () => {
            const registry = new ModeRegistry();
            expect(() => {
                registry.register({ name: 123, displayName: 'Test', systemPrompt: 'Test' } as any);
            }).toThrowError(/ModeConfig.name is required and must be a non-empty string/);
        });

        it('should reject a mode without a displayName', () => {
            const registry = new ModeRegistry();
            expect(() => {
                registry.register({ name: 'test', systemPrompt: 'Test' } as any);
            }).toThrowError(/ModeConfig.displayName is required/);
        });

        it('should reject a mode without a systemPrompt', () => {
            const registry = new ModeRegistry();
            expect(() => {
                registry.register({ name: 'test', displayName: 'Test' } as any);
            }).toThrowError(/ModeConfig.systemPrompt must be a string/);
        });

        it('should reject a mode with non-array tool fields', () => {
            const registry = new ModeRegistry();
            expect(() => {
                registry.register({
                    name: 'test',
                    displayName: 'Test',
                    systemPrompt: 'Test',
                    allowedToolCategories: 'filesystem' as any,
                });
            }).toThrowError(/ModeConfig.allowedToolCategories must be an array/);
        });

        it('should reject a mode with non-boolean blockAllTools', () => {
            const registry = new ModeRegistry();
            expect(() => {
                registry.register({
                    name: 'test',
                    displayName: 'Test',
                    systemPrompt: 'Test',
                    blockAllTools: 'true' as any,
                });
            }).toThrowError(/ModeConfig.blockAllTools must be a boolean/);
        });
    });
});
