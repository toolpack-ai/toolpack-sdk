import { describe, it, expect } from 'vitest';
import { BUILT_IN_MODES, DEFAULT_MODE_NAME } from '../../src/modes/built-in-modes.js';

describe('BUILT_IN_MODES', () => {
    it('should have at least one mode', () => {
        expect(BUILT_IN_MODES.length).toBeGreaterThan(0);
    });

    it('should have required fields on every mode', () => {
        for (const mode of BUILT_IN_MODES) {
            expect(mode.name).toBeDefined();
            expect(typeof mode.name).toBe('string');
            expect(mode.name.length).toBeGreaterThan(0);

            expect(mode.displayName).toBeDefined();
            expect(typeof mode.displayName).toBe('string');
            expect(mode.displayName.length).toBeGreaterThan(0);

            expect(mode.systemPrompt).toBeDefined();
            expect(typeof mode.systemPrompt).toBe('string');
        }
    });

    it('should have no duplicate mode names', () => {
        const names = BUILT_IN_MODES.map(m => m.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('should contain the DEFAULT_MODE_NAME', () => {
        const names = BUILT_IN_MODES.map(m => m.name);
        expect(names).toContain(DEFAULT_MODE_NAME);
    });

    it('should export DEFAULT_MODE_NAME as a non-empty string', () => {
        expect(typeof DEFAULT_MODE_NAME).toBe('string');
        expect(DEFAULT_MODE_NAME.length).toBeGreaterThan(0);
    });
});
