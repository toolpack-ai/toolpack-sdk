export interface AgentContextOptions {
    workingDirectory: string;
    toolCategories: string[];
    disabled?: boolean;
    /** Whether to include working directory in the context. Default: true */
    includeWorkingDirectory?: boolean;
    /** Whether to include tool categories in the context. Default: true */
    includeToolCategories?: boolean;
}

/**
 * Generates the base agent context string that is always injected into the system prompt.
 * This gives the AI baseline awareness of its environment and tools, ensuring proactive behavior
 * regardless of the active mode or consumer configuration.
 */
export function generateBaseAgentContext(options: AgentContextOptions): string {
    if (options.disabled) {
        return '';
    }

    const includeWd = options.includeWorkingDirectory !== false;
    const includeCategories = options.includeToolCategories !== false;

    const wdLine = includeWd ? `\nWorking directory: ${options.workingDirectory}` : '';
    const categoriesList = includeCategories && options.toolCategories.length > 0
        ? `\nAvailable tool categories: ${options.toolCategories.join(', ')}`
        : '';

    return `You are an AI assistant with access to tools that let you interact with the user's system.${wdLine}${categoriesList}

When the user asks you to do something, be proactive:
- Use your tools to find information rather than asking the user for details you can discover yourself
- Read files, list directories, and explore the codebase when asked to analyze or understand a project
- Only ask the user for clarification when you genuinely cannot determine their intent or lack the required tools`;
}
