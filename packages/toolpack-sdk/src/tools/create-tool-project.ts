import { ToolDefinition, ToolProject, ToolProjectDependencies } from "./types.js";
import { logWarn } from '../providers/provider-logger.js';

export function createToolProject(config: {
    key: string;
    name: string;
    displayName: string;
    version: string;
    description: string;
    category: string;
    author?: string;
    repository?: string;
    tools: ToolDefinition[];
    dependencies?: ToolProjectDependencies;
}): ToolProject {
    // Validations
    if (!config.key || !/^[a-z0-9-]+$/.test(config.key)) {
        throw new Error(`Invalid tool project key: "${config.key}". Must be non-empty, lowercase, and contain no spaces (use hyphens).`);
    }

    if (!config.name.trim()) {
        throw new Error('Tool project name cannot be empty.');
    }

    if (!config.tools || config.tools.length === 0) {
        throw new Error('Tool project must contain at least one tool.');
    }

    for (const tool of config.tools) {
        if (!tool.name) throw new Error('Tool is missing a name.');
        if (!tool.description) throw new Error(`Tool "${tool.name}" is missing a description.`);
        if (!tool.parameters) throw new Error(`Tool "${tool.name}" is missing parameters.`);
        if (typeof tool.execute !== 'function') throw new Error(`Tool "${tool.name}" is missing an execute function.`);

        if (tool.category !== config.category) {
            logWarn(`[Toolpack] Tool "${tool.name}" has category "${tool.category}" which does not match project category "${config.category}".`);
        }
    }

    // Auto-generate tool names for manifest
    const toolNames = config.tools.map(t => t.name);

    return {
        manifest: {
            key: config.key,
            name: config.name,
            displayName: config.displayName,
            version: config.version,
            description: config.description,
            author: config.author,
            repository: config.repository,
            category: config.category,
            tools: toolNames,
        },
        dependencies: config.dependencies,
        tools: config.tools,
    };
}
