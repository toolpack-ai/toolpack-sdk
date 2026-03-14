import { ModeConfig } from './mode-types.js';

/**
 * Create a ModeConfig with sensible defaults.
 * Only `name`, `displayName`, and `systemPrompt` are required.
 * All tool-filtering arrays default to empty (= all allowed).
 *
 * @example
 * ```typescript
 * const reviewMode = createMode({
 *   name: 'review',
 *   displayName: 'Code Review',
 *   systemPrompt: 'You are a code reviewer. Read-only access.',
 *   allowedToolCategories: ['filesystem', 'coding', 'git'],
 *   blockedTools: ['fs.write_file', 'fs.delete_file'],
 * });
 * ```
 */
export function createMode(config: {
    /** Unique identifier (e.g., "review", "devops") */
    name: string;
    /** Human-readable name for UI (e.g., "Code Review") */
    displayName: string;
    /** System prompt injected into every request in this mode */
    systemPrompt: string;
    /** Short description for tooltips. Defaults to displayName. */
    description?: string;
    /** Tool categories to allow. Empty = all allowed. */
    allowedToolCategories?: string[];
    /** Tool categories to block. Overrides allowed. */
    blockedToolCategories?: string[];
    /** Specific tools to allow. Empty = all allowed. */
    allowedTools?: string[];
    /** Specific tools to block. Overrides allowed. */
    blockedTools?: string[];
    /** If true, no tools at all (pure conversation). Default: false. */
    blockAllTools?: boolean;
    /** Base context configuration. Controls working directory and tool category injection. */
    baseContext?: {
        includeWorkingDirectory?: boolean;
        includeToolCategories?: boolean;
        custom?: string;
    } | false;
    /** Workflow configuration. See 01-WORKFLOW_ENGINE.md for details. */
    workflow?: {
        planning?: { enabled: boolean; requireApproval?: boolean; };
        steps?: { enabled: boolean; retryOnFailure?: boolean; allowDynamicSteps?: boolean; };
        progress?: { enabled: boolean; };
    };
}): ModeConfig {
    return {
        name: config.name,
        displayName: config.displayName,
        description: config.description || config.displayName,
        systemPrompt: config.systemPrompt,
        allowedToolCategories: config.allowedToolCategories || [],
        blockedToolCategories: config.blockedToolCategories || [],
        allowedTools: config.allowedTools || [],
        blockedTools: config.blockedTools || [],
        blockAllTools: config.blockAllTools || false,
        baseContext: config.baseContext,
        workflow: config.workflow,
    };
}
