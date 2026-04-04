import { ToolDefinition, ToolSchema, ToolProject, ToolsConfig, DEFAULT_TOOLS_CONFIG } from "./types.js";

/**
 * Central registry for all tools (built-in + custom).
 * Handles registration, lookup, filtering by category, schema extraction,
 * and loading tool projects.
 */
export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();
    private projects: Map<string, ToolProject> = new Map();
    private config: ToolsConfig = DEFAULT_TOOLS_CONFIG;

    /**
     * Register a tool (built-in or custom).
     */
    register(tool: ToolDefinition): void {
        this.tools.set(tool.name, tool);
    }

    /**
     * Register a custom tool provided by the consumer.
     * Identical to register() but semantically distinct for clarity.
     */
    registerCustom(tool: ToolDefinition): void {
        this.tools.set(tool.name, tool);
    }

    /**
     * Get a tool by name.
     */
    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    /**
     * Check if a tool exists.
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Get all registered tool names.
     */
    getNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Get all tools in a specific category.
     */
    getByCategory(category: string): ToolDefinition[] {
        return Array.from(this.tools.values()).filter(t => t.category === category);
    }

    /**
     * Get all enabled tools based on config.
     * If enabledTools and enabledToolCategories are both empty, returns all registered tools.
     * Otherwise, returns only tools from enabledTools[] + enabledToolCategories[].
     */
    getEnabled(): ToolDefinition[] {
        if (this.config.enabledTools.length === 0 && this.config.enabledToolCategories.length === 0) {
            return Array.from(this.tools.values());
        }

        // Build filtered list from explicit tools + categories
        const fromNames = this.getByNames(this.config.enabledTools);
        const fromCategories = this.getByCategories(this.config.enabledToolCategories);

        // Deduplicate by name
        const seen = new Set<string>();
        const result: ToolDefinition[] = [];
        for (const tool of [...fromNames, ...fromCategories]) {
            if (!seen.has(tool.name)) {
                seen.add(tool.name);
                result.push(tool);
            }
        }
        return result;
    }

    /**
     * Get tool schemas suitable for sending to AI providers.
     * If toolNames is provided, only return schemas for those tools.
     * Otherwise, return schemas for all enabled tools.
     */
    getSchemas(toolNames?: string[]): ToolSchema[] {
        const tools = toolNames
            ? toolNames.map(n => this.tools.get(n)).filter(Boolean) as ToolDefinition[]
            : this.getEnabled();

        return tools.map(t => ({
            name: t.name,
            displayName: t.displayName,
            description: t.description,
            parameters: t.parameters,
            category: t.category,
        }));
    }

    /**
     * Get all tools matching a list of names.
     */
    getByNames(names: string[]): ToolDefinition[] {
        return names.map(n => this.tools.get(n)).filter(Boolean) as ToolDefinition[];
    }

    /**
     * Get all tools matching a list of categories.
     */
    getByCategories(categories: string[]): ToolDefinition[] {
        const categorySet = new Set(categories);
        return Array.from(this.tools.values()).filter(t => categorySet.has(t.category));
    }

    /**
     * Get all registered categories (derived from tools).
     */
    getCategories(): string[] {
        const cats = new Set<string>();
        for (const tool of this.tools.values()) {
            cats.add(tool.category);
        }
        return Array.from(cats);
    }

    /**
     * Get all registered tools.
     * Used by BM25SearchEngine for indexing.
     */
    getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /**
     * Update the config (called by config loader).
     */
    setConfig(config: ToolsConfig): void {
        this.config = config;
    }

    /**
     * Get the current config.
     */
    getConfig(): ToolsConfig {
        return this.config;
    }

    /**
     * Get the total number of registered tools.
     */
    get size(): number {
        return this.tools.size;
    }

    /**
     * Validate that a tool project's declared dependencies are resolvable.
     * Returns an array of missing package names (empty = all good).
     */
    async validateDependencies(project: ToolProject): Promise<string[]> {
        const deps = project.dependencies;
        if (!deps || Object.keys(deps).length === 0) return [];

        const missing: string[] = [];
        for (const packageName of Object.keys(deps)) {
            try {
                await import(packageName);
            } catch {
                missing.push(packageName);
            }
        }
        return missing;
    }

    /**
     * Load a single tool project into the registry.
     * Validates dependencies before loading — throws if any are missing.
     */
    async loadProject(project: ToolProject): Promise<void> {
        const missing = await this.validateDependencies(project);
        if (missing.length > 0) {
            throw new Error(
                `Tool project "${project.manifest.name}" has missing dependencies: ${missing.join(', ')}. ` +
                `Install them with: npm install ${missing.join(' ')}`
            );
        }
        this.projects.set(project.manifest.name, project);
        for (const tool of project.tools) {
            this.register(tool);
        }
    }

    /**
     * Load multiple tool projects.
     */
    async loadProjects(projects: ToolProject[]): Promise<void> {
        for (const project of projects) {
            await this.loadProject(project);
        }
    }

    /**
     * Get a loaded project by name.
     */
    getProject(name: string): ToolProject | undefined {
        return this.projects.get(name);
    }

    /**
     * Get all loaded projects.
     */
    getProjects(): ToolProject[] {
        return Array.from(this.projects.values());
    }

    /**
     * Get all loaded project names.
     */
    getProjectNames(): string[] {
        return Array.from(this.projects.keys());
    }

    /**
     * Load all built-in tool projects.
     */
    async loadBuiltIn(): Promise<void> {
        const { fsToolsProject } = await import('./fs-tools/index.js');
        const { execToolsProject } = await import('./exec-tools/index.js');
        const { systemToolsProject } = await import('./system-tools/index.js');
        const { httpToolsProject } = await import('./http-tools/index.js');
        const { webToolsProject } = await import('./web-tools/index.js');
        const { codingToolsProject } = await import('./coding-tools/index.js');
        const { gitToolsProject } = await import('./git-tools/index.js');
        const { diffToolsProject } = await import('./diff-tools/index.js');
        const { dbToolsProject } = await import('./db-tools/index.js');
        const { cloudToolsProject } = await import('./cloud-tools/index.js');
        await this.loadProjects([fsToolsProject, execToolsProject, systemToolsProject, httpToolsProject, webToolsProject, codingToolsProject, gitToolsProject, diffToolsProject, dbToolsProject, cloudToolsProject]);
    }
}
