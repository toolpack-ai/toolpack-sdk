import { WorkflowConfig } from '../workflows/workflow-types.js';

/**
 * Configuration for an AI agent mode.
 * A mode shapes AI behavior by controlling which tools are available
 * and injecting a persona-specific system prompt.
 */
export interface ModeConfig {
    /** Unique identifier for the mode (e.g., "all", "ask", "code") */
    name: string;

    /** Human-readable display name (e.g., "All", "Ask", "Code") */
    displayName: string;

    /** Short description for UI tooltips */
    description: string;

    /**
     * System prompt prepended to every request in this mode.
     * Empty string means no system prompt injection (passthrough).
     */
    systemPrompt: string;

    /**
     * Base agent context configuration for this mode.
     * Controls whether working directory and tool categories are injected into system prompt.
     *
     * - undefined: Use global default behavior (include everything)
     * - false: Disable base context entirely
     * - object: Fine-grained control over what is included
     */
    baseContext?: {
        /** Include working directory in system prompt. Default: true */
        includeWorkingDirectory?: boolean;
        /** Include available tool categories. Default: true */
        includeToolCategories?: boolean;
        /** Custom base context string (overrides auto-generated). */
        custom?: string;
    } | false;

    /** Workflow configuration controlling planning, steps, and progress. */
    workflow?: WorkflowConfig;

    /**
     * Tool search configuration specific to this mode.
     * Overrides or extends the global toolSearch config.
     */
    toolSearch?: {
        /** Enable/disable tool search for this mode */
        enabled?: boolean;
        /** Tools to always include (never defer) for this mode */
        alwaysLoadedTools?: string[];
        /** Categories to always include for this mode */
        alwaysLoadedCategories?: string[];
    };

    /**
     * Tool categories allowed in this mode.
     * Empty array means all categories are allowed (unless blocked).
     */
    allowedToolCategories: string[];

    /**
     * Tool categories explicitly blocked in this mode.
     * Takes precedence over allowedToolCategories.
     */
    blockedToolCategories: string[];

    /**
     * Specific tool names allowed in this mode.
     * Empty array means all tools are allowed (unless blocked).
     */
    allowedTools: string[];

    /**
     * Specific tool names explicitly blocked in this mode.
     * Takes precedence over allowedTools.
     */
    blockedTools: string[];

    /**
     * If true, ALL tools are blocked regardless of other settings.
     * Shorthand for "no tool calls at all".
     */
    blockAllTools: boolean;

    /**
     * Response format constraint for all requests in this mode.
     * - 'json_object': instructs the model to return valid JSON as its text content.
     *   Useful for evaluator/parser agents whose final response must be machine-readable.
     *   Tool-call rounds are unaffected — the model still returns functionCall parts
     *   normally; the format only applies to text content.
     * - 'text' (default): plain text, no constraint.
     */
    response_format?: 'text' | 'json_object';
}

/**
 * A lightweight reference to a mode, used in tool-blocked hints.
 */
export interface ModeBlockedHint {
    blockedToolNames: string[];
    suggestedMode: string;
}
