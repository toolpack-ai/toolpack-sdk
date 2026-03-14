import { describe, it, expect } from 'vitest';
import { createMode } from '../../src/modes/create-mode.js';

describe('createMode', () => {
    it('should create a ModeConfig with only required fields and set defaults', () => {
        const mode = createMode({
            name: 'minimal',
            displayName: 'Minimal Mode',
            systemPrompt: 'Just the basics.',
        });

        expect(mode.name).toBe('minimal');
        expect(mode.displayName).toBe('Minimal Mode');
        expect(mode.description).toBe('Minimal Mode'); // Defaulted to displayName
        expect(mode.systemPrompt).toBe('Just the basics.');

        // Arrays defaulted to empty
        expect(mode.allowedToolCategories).toEqual([]);
        expect(mode.blockedToolCategories).toEqual([]);
        expect(mode.allowedTools).toEqual([]);
        expect(mode.blockedTools).toEqual([]);

        // Booleans defaulted
        expect(mode.blockAllTools).toBe(false);

        // Optional objects undefined
        expect(mode.baseContext).toBeUndefined();
        expect(mode.workflow).toBeUndefined();
    });

    it('should pass through all provided fields', () => {
        const mode = createMode({
            name: 'full',
            displayName: 'Full Mode',
            description: 'A fully configured mode',
            systemPrompt: 'Full details.',
            allowedToolCategories: ['filesystem'],
            blockedToolCategories: ['execution'],
            allowedTools: ['fs.read_file'],
            blockedTools: ['fs.write_file'],
            blockAllTools: true,
            baseContext: {
                includeWorkingDirectory: false,
                includeToolCategories: true,
                custom: 'Custom context.',
            },
            workflow: {
                planning: { enabled: true, requireApproval: true },
                steps: { enabled: true, retryOnFailure: false, allowDynamicSteps: false },
                progress: { enabled: true },
            },
        });

        expect(mode.description).toBe('A fully configured mode');
        expect(mode.allowedToolCategories).toEqual(['filesystem']);
        expect(mode.blockedToolCategories).toEqual(['execution']);
        expect(mode.allowedTools).toEqual(['fs.read_file']);
        expect(mode.blockedTools).toEqual(['fs.write_file']);
        expect(mode.blockAllTools).toBe(true);
        expect(mode.baseContext).toEqual({
            includeWorkingDirectory: false,
            includeToolCategories: true,
            custom: 'Custom context.',
        });
        expect(mode.workflow?.planning?.enabled).toBe(true);
    });

    it('should accept false for baseContext', () => {
        const mode = createMode({
            name: 'no-context',
            displayName: 'No Context',
            systemPrompt: 'No base context.',
            baseContext: false,
        });

        expect(mode.baseContext).toBe(false);
    });
});
