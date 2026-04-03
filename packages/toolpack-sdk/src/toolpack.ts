import { EventEmitter } from 'events';
import { AIClient } from './client';
import {
    ProviderAdapter,
    CompletionRequest,
    CompletionResponse,
    CompletionChunk,
    EmbeddingRequest,
    EmbeddingResponse,
} from './providers/base';
import { ProviderInfo, ProviderModelInfo } from './types';
import { OpenAIAdapter } from './providers/openai';
import { AnthropicAdapter } from './providers/anthropic';
import { GeminiAdapter } from './providers/gemini';
import { OllamaAdapter, OllamaProvider } from './providers/ollama';
import { getOllamaBaseUrl } from './providers/config';
import { initLogger, logWarn,logError,logInfo } from './providers/provider-logger';
import { ToolRegistry } from './tools/registry';
import { loadToolsConfig, loadFullConfig, ToolProject } from './tools';
import { ModeConfig } from './modes/mode-types.js';
import { ModeRegistry } from './modes/mode-registry.js';
import { DEFAULT_MODE_NAME } from './modes/built-in-modes.js';
import { WorkflowExecutor } from './workflows/workflow-executor.js';
import { DEFAULT_WORKFLOW_CONFIG } from './workflows/workflow-types.js';
import { createMcpToolProject, disconnectMcpToolProject, McpToolsConfig } from './tools';

export interface ProviderOptions {
    /**
     * API key for the provider.
     * Required for: openai, anthropic, gemini.
     * Not needed for: ollama-*.
     * If omitted, the SDK attempts to read TOOLPACK_<PROVIDER>_KEY from env.
     */
    apiKey?: string;

    /** Model name override */
    model?: string;

    /** Base URL override (for OpenAI-compatible endpoints or custom Ollama host) */
    baseUrl?: string;
}

export interface ToolpackInitConfig {
    /** Single provider shorthand (e.g. 'openai', 'anthropic', 'gemini') */
    provider?: string;

    /**
     * Optional API key override for the single provider.
     * If not provided, the SDK auto-reads TOOLPACK_<PROVIDER>_KEY from env.
     */
    apiKey?: string;

    /** Model name for the single provider */
    model?: string;

    /** Load built-in tools (fs, http, etc.)? Default: false */
    tools?: boolean;

    /** Custom tool projects to load in addition to built-ins */
    customTools?: ToolProject[];

    /** Multi-provider config (overrides single provider settings) */
    providers?: Record<string, ProviderOptions>;

    /** Default provider to use if multiple are configured */
    defaultProvider?: string;

    /** Custom modes to register (in addition to built-ins) */
    customModes?: ModeConfig[];

    /** Default mode to activate on init (default: 'default') */
    defaultMode?: string;

    /** Optional system prompt overrides for specific modes */
    modeOverrides?: Record<string, Partial<ModeConfig>>;

    /**
     * Custom provider adapter instances.
     * Can be:
     * - Array of adapters (name auto-extracted from adapter.name property)
     * - Record keyed by provider name
     */
    customProviders?: ProviderAdapter[] | Record<string, ProviderAdapter>;

    /** Disable base agent context injection (for testing or custom prompts) */
    disableBaseContext?: boolean;

    /** 
     * Optional path to a configuration file. 
     * If provided, the SDK will load configuration from this path instead of the default toolpack.config.json in the current working directory.
     */
    configPath?: string;

    /* MCP Tools configuration 
    * When provided. copnnects to MCP servers and register tools */
    mcp?: McpToolsConfig;
}

export class Toolpack extends EventEmitter {
    private client: AIClient;
    private activeProviderName: string;
    private modeRegistry: ModeRegistry;
    private workflowExecutor: WorkflowExecutor;
    public customProviderNames: Set<string> = new Set();
    private mcpToolProject: ToolProject | null = null;

    private constructor(client: AIClient, defaultProvider: string, modeRegistry: ModeRegistry) {
        super();
        this.client = client;
        this.activeProviderName = defaultProvider;
        this.modeRegistry = modeRegistry;

        // Forward status events from atomic adapters
        const provider = this.client.getProvider(defaultProvider);
        if (provider) {
            this.forwardEvents(provider);
        }

        // Initialize WorkflowExecutor
        this.workflowExecutor = new WorkflowExecutor(this.client, DEFAULT_WORKFLOW_CONFIG);
        this.forwardWorkflowEvents();
    }

    /**
     * Initialize the Toolpack SDK.
     * 
     * @param config Configuration options
     * @returns Ready-to-use Toolpack instance
     */
    static async init(config: ToolpackInitConfig): Promise<Toolpack> {
        // 0. Load full config once and initialize logger first
        const fullConfig = loadFullConfig(config.configPath);
        initLogger(fullConfig.logging);
        
        // 1. Setup Tool Registry
        const registry = new ToolRegistry();
        const toolsConfig = loadToolsConfig(config.configPath);
        registry.setConfig(toolsConfig);

        if (config.tools) {
            await registry.loadBuiltIn();
        }
        if (config.customTools) {
            await registry.loadProjects(config.customTools);
        }

        // Load MCP tools from config if provided
        let mcpToolProject: ToolProject | null = null;
        const mcpConfig = config.mcp || fullConfig.mcp;
        if (mcpConfig) {
            try {
                logInfo('[MCP] Initializing MCP tool integration');
                const project = await createMcpToolProject(mcpConfig as McpToolsConfig);
                mcpToolProject = project;
                await registry.loadProjects([project]);
                logInfo(`[MCP] Loaded ${project.tools.length} tools from MCP servers`);
            } catch (error) {
                logError(`[MCP] Failed to initialize MCP tools: ${error}`);
                // Continue without MCP tools rather than failing completely
            }
        }

        // 1b. Extract config overrides (systemPrompt, baseContext, modeOverrides)
        const systemPrompt = fullConfig.systemPrompt;
        const disableBaseContext = config.disableBaseContext || fullConfig.disableBaseContext || fullConfig.baseContext === false || false;
        const configModeOverrides = fullConfig.modeOverrides || {};

        // 2. Resolve Providers
        const providers: Record<string, ProviderAdapter> = {};
        const customProviderNames = new Set<string>();
        let defaultProviderName = config.defaultProvider || config.provider;

        if (config.providers) {
            // Multi-provider mode - skip providers without API keys (they can be used later if keys are set)
            for (const [name, opts] of Object.entries(config.providers)) {
                const isDefault = name === defaultProviderName;
                const provider = await Toolpack.createProvider(name, opts, config.configPath, !isDefault);
                if (provider) {
                    providers[name] = provider;
                }
            }
        } else if (config.provider) {
            // Single-provider mode - API key is required
            const opts: ProviderOptions = {
                apiKey: config.apiKey,
                model: config.model,
            };
            const provider = await Toolpack.createProvider(config.provider, opts, config.configPath, false);
            if (provider) {
                providers[config.provider] = provider;
            }
        } else if (!config.customProviders) {
            throw new Error('No provider specified. Pass { provider: "name" }, { providers: { ... } }, or { customProviders: { ... } } to init().');
        }

        // Register custom providers (supports both array and record syntax)
        if (config.customProviders) {
            const customList = Array.isArray(config.customProviders)
                ? config.customProviders
                : Object.entries(config.customProviders).map(([name, adapter]) => {
                    adapter.name = adapter.name || name;
                    return adapter;
                });

            for (const adapter of customList) {
                // Duck-typing validation to support both extending ProviderAdapter and simply implementing it
                if (typeof adapter.generate !== 'function' || typeof adapter.stream !== 'function' || typeof adapter.embed !== 'function') {
                    throw new Error(
                        `Custom provider must implement the ProviderAdapter interface (generate, stream, embed methods). ` +
                        `Import { ProviderAdapter } from 'toolpack' and implement or extend it.`
                    );
                }

                const name = adapter.name;
                if (!name) {
                    throw new Error(
                        `Custom provider must have a 'name' property set. ` +
                        `Set adapter.name in the constructor or use the record syntax: { 'provider-name': adapter }`
                    );
                }

                if (providers[name]) {
                    throw new Error(
                        `Custom provider name "${name}" conflicts with a built-in provider designation. ` +
                        `Choose a different name.`
                    );
                }
                customProviderNames.add(name);
                providers[name] = adapter;
            }
        }

        if (!defaultProviderName && config.customProviders) {
            const firstAdapter = Array.isArray(config.customProviders)
                ? config.customProviders[0]
                : Object.values(config.customProviders)[0];
            defaultProviderName = firstAdapter?.name;
        }

        if (!defaultProviderName) {
            throw new Error('No default provider specified.');
        }

        // 3. Mode Registry
        const modeRegistry = new ModeRegistry();

        // Register custom modes
        if (config.customModes) {
            for (const mode of config.customModes) {
                modeRegistry.register(mode);
            }
        }

        // Apply mode overrides
        const finalModeOverrides = { ...configModeOverrides, ...(config.modeOverrides || {}) };
        for (const [modeName, override] of Object.entries(finalModeOverrides)) {
            const mode = modeRegistry.get(modeName);
            if (mode) {
                // Merge system prompt
                if (override.systemPrompt !== undefined) {
                    mode.systemPrompt = override.systemPrompt;
                }
                
                // Deep merge toolSearch configuration
                if (override.toolSearch) {
                    mode.toolSearch = {
                        ...(mode.toolSearch || {}),
                        ...override.toolSearch
                    };
                }
                
                // Apply other shallow overrides
                for (const [key, value] of Object.entries(override)) {
                    if (key !== 'systemPrompt' && key !== 'toolSearch') {
                        (mode as any)[key] = value;
                    }
                }
            }
        }

        // 4. Initialize Client
        const client = new AIClient({
            providers,
            defaultProvider: defaultProviderName,
            toolRegistry: registry,
            toolsConfig: registry.getConfig(),
            systemPrompt: systemPrompt,
            disableBaseContext: disableBaseContext,
        });

        const instance = new Toolpack(client, defaultProviderName, modeRegistry);
        instance.customProviderNames = customProviderNames;
        instance.mcpToolProject = mcpToolProject;
        // 5. Set default mode (and workflow config)
        const modeName = config.defaultMode || DEFAULT_MODE_NAME;
        const defaultMode = modeRegistry.get(modeName);
        if (defaultMode) {
            client.setMode(defaultMode);
            if (defaultMode.workflow) {
                instance.workflowExecutor.setConfig(defaultMode.workflow);
            }
        }


        return instance;
    }

    /**
     * Factory to create provider instances.
     */
    private static async createProvider(name: string, opts: ProviderOptions, configPath?: string, skipIfNoKey = false): Promise<ProviderAdapter | null> {
        // 1. API Providers
        if (['openai', 'anthropic', 'gemini'].includes(name)) {
            const envKey = `TOOLPACK_${name.toUpperCase()}_KEY`;
            const apiKey = opts.apiKey || process.env[envKey] || process.env[`${name.toUpperCase()}_API_KEY`];

            if (!apiKey) {
                if (skipIfNoKey) {
                    return null; // Skip this provider silently - no API key configured
                }
                throw new Error(`No API key found for '${name}'. Set ${envKey} or pass apiKey in config.`);
            }

            switch (name) {
                case 'openai': return new OpenAIAdapter(apiKey, opts.baseUrl);
                case 'anthropic': return new AnthropicAdapter(apiKey, opts.baseUrl);
                case 'gemini': return new GeminiAdapter(apiKey);
            }
        }

        // 2. Ollama Provider (Dynamic auto-discovery)
        if (name === 'ollama') {
            return new OllamaProvider({
                baseUrl: opts.baseUrl || getOllamaBaseUrl(configPath),
            });
        }

        // 3. Ollama Providers (Legacy per-model)
        if (name.startsWith('ollama-')) {
            const model = opts.model || name.replace(/^ollama-/, '');
            const baseUrl = opts.baseUrl || getOllamaBaseUrl(configPath);
            const adapter = new OllamaAdapter({ model, baseUrl });

            // Creating the adapter is safe here.
            return adapter;
        }



        throw new Error(`Unknown provider type: ${name}`);
    }

    // ========================================================================
    // Facade Methods
    // ========================================================================

    async generate(request: CompletionRequest | string, providerName?: string): Promise<CompletionResponse> {
        let req: CompletionRequest;
        if (typeof request === 'string') {
            req = {
                messages: [{ role: 'user', content: request }],
                model: '', // Adapter handles defaults
            };
        } else {
            req = request;
        }

        const mode = this.getMode();
        if (mode?.workflow?.planning?.enabled || mode?.workflow?.steps?.enabled) {
            // Workflow mode: use WorkflowExecutor
            const result = await this.workflowExecutor.execute(req, providerName || this.activeProviderName);

            // Calculate aggregated token usage across the entire workflow
            let totalPromptTokens = 0;
            let totalCompletionTokens = 0;
            let totalTokens = 0;
            
            const usage_details: NonNullable<CompletionResponse['usage_details']> = {
                steps: []
            };

            // Add planning phase usage if available
            if (result.plan.planningResponse?.usage) {
                totalPromptTokens += result.plan.planningResponse.usage.prompt_tokens;
                totalCompletionTokens += result.plan.planningResponse.usage.completion_tokens || 0;
                totalTokens += result.plan.planningResponse.usage.total_tokens;
                
                usage_details.planning = result.plan.planningResponse.usage;
            }

            // Add usage from all completed steps
            for (const step of result.plan.steps) {
                if (step.status === 'completed' && step.result?.response?.usage) {
                    const stepUsage = step.result.response.usage;
                    totalPromptTokens += stepUsage.prompt_tokens;
                    totalCompletionTokens += stepUsage.completion_tokens || 0;
                    totalTokens += stepUsage.total_tokens;

                    usage_details.steps!.push({
                        stepNumber: step.number,
                        description: step.description,
                        usage: stepUsage
                    });
                }
            }

            const aggregatedUsage = {
                prompt_tokens: totalPromptTokens,
                completion_tokens: totalCompletionTokens,
                total_tokens: totalTokens
            };

            // Map WorkflowResult back to CompletionResponse
            // If we have the full response from the last step, return it with updated content
            if (result.response) {
                return {
                    ...result.response,
                    content: result.output || result.response.content || null,
                    usage: aggregatedUsage,
                    usage_details
                };
            }
            
            // Fallback for cases without response metadata
            return {
                content: result.output || null,
                usage: aggregatedUsage,
                usage_details
            };
        }

        // Direct execution
        return this.client.generate(req, providerName);
    }

    async *stream(request: CompletionRequest, providerName?: string): AsyncGenerator<CompletionChunk> {
        const mode = this.getMode();
        const provider = providerName || this.activeProviderName;

        // If mode has workflow enabled, use WorkflowExecutor.stream()
        if (mode?.workflow?.planning?.enabled || mode?.workflow?.steps?.enabled) {
            yield* this.workflowExecutor.stream(request, provider);
            return;
        }

        // Direct streaming (no workflow)
        yield* this.client.stream(request, providerName);
    }

    async embed(request: EmbeddingRequest, providerName?: string): Promise<EmbeddingResponse> {
        return this.client.embed(request, providerName);
    }

    /**
     * Switch the active provider for the client.
     */
    setProvider(name: string): void {
        const provider = this.client.getProvider(name); // Throws if not found
        this.activeProviderName = name;
        this.client.setDefaultProvider(name); // Also update client's default
        this.forwardEvents(provider);
    }

    getProvider(): ProviderAdapter {
        return this.client.getProvider(this.activeProviderName);
    }

    /**
     * Get the underlying AIClient instance.
     * Useful for listening to tool progress events.
     */
    getClient(): AIClient {
        return this.client;
    }

    /**
     * Get the WorkflowExecutor instance.
     * Useful for workflow events and approval flows.
     */
    getWorkflowExecutor(): WorkflowExecutor {
        return this.workflowExecutor;
    }

    /**
     * Disconnect the active provider (e.g. close Chrome).
     */
    async disconnect(): Promise<void> {
        const provider = this.getProvider();
        if (provider && 'disconnect' in provider) {
            await (provider as unknown as { disconnect(): Promise<void> }).disconnect();
        }
        
        //disconnect MCP tool project if exists
        if(this.mcpToolProject){
            await disconnectMcpToolProject(this.mcpToolProject);
        }
    }

    /**
     * List all registered providers and their available models.
     */
    async listProviders(): Promise<ProviderInfo[]> {
        const providersMap = this.client.getProviders();
        const results: ProviderInfo[] = [];

        for (const [name, adapter] of providersMap.entries()) {
            const isCustom = this.customProviderNames.has(name);
            let models: ProviderModelInfo[] = [];

            try {
                models = await adapter.getModels();
            } catch (err) {
                // Skip fetching models if the provider throws (e.g. API down, missing credentials)
                logWarn(`[Toolpack] Failed to fetch models for provider '${name}': ${err}`);
            }

            results.push({
                name,
                displayName: adapter.getDisplayName(),
                type: isCustom ? 'custom' : 'built-in',
                models
            });
        }

        return results;
    }

    /**
     * Load a custom tool project at runtime.
     * Validates dependencies and registers all tools.
     */
    async loadToolProject(project: ToolProject): Promise<void> {
        const registry = this.client.getToolRegistry();
        if (registry) {
            await registry.loadProject(project);
        } else {
            throw new Error('No tool registry configured. Initialize Toolpack with tools enabled.');
        }
    }

    /**
     * Convenience method to get a flat list of all models across all providers.
     */
    async listModels(): Promise<(ProviderModelInfo & { provider: string })[]> {
        const providers = await this.listProviders();
        const flatList: (ProviderModelInfo & { provider: string })[] = [];

        for (const provider of providers) {
            for (const model of provider.models) {
                flatList.push({
                    ...model,
                    provider: provider.name
                });
            }
        }

        return flatList;
    }

    // ========================================================================
    // Mode Methods
    // ========================================================================

    /**
     * Set the active mode by name. Throws if not found.
     */
    setMode(name: string): ModeConfig {
        const mode = this.modeRegistry.get(name);
        if (!mode) {
            throw new Error(`Mode "${name}" not found. Available modes: ${this.modeRegistry.getNames().join(', ')}`);
        }
        this.client.setMode(mode);
        if (mode.workflow) {
            this.workflowExecutor.setConfig(mode.workflow);
        } else {
            this.workflowExecutor.setConfig(DEFAULT_WORKFLOW_CONFIG);
        }
        return mode;
    }

    /**
     * Get the currently active mode, or null if none.
     */
    getMode(): ModeConfig | null {
        return this.client.getMode();
    }

    /**
     * Get the active mode's display name (e.g. "Default", "Explore", "Agent", "Chat").
     */
    getActiveModeName(): string {
        const mode = this.client.getMode();
        return mode ? mode.displayName : 'Default';
    }

    /**
     * Get all registered modes in cycle order.
     */
    getModes(): ModeConfig[] {
        return this.modeRegistry.getAll();
    }

    /**
     * Cycle to the next mode and return it.
     */
    cycleMode(): ModeConfig {
        const current = this.client.getMode();
        const currentName = current ? current.name : 'default';
        const next = this.modeRegistry.getNext(currentName);
        this.client.setMode(next);
        return next;
    }

    /**
     * Register a custom mode at runtime.
     */
    registerMode(mode: ModeConfig): void {
        this.modeRegistry.register(mode);
    }

    private forwardEvents(provider: ProviderAdapter) {
        // Check if provider is an EventEmitter (it should be)
        if (provider instanceof EventEmitter) {
            provider.on('status', (msg: string) => this.emit('status', msg));
        }
    }

    private forwardWorkflowEvents() {
        // Forward workflow events to the toolpack's emitter
        const executor = this.workflowExecutor;
        executor.on('workflow:plan_created', (plan) => this.emit('workflow:plan_created', plan));
        executor.on('workflow:plan_decision', (plan, app) => this.emit('workflow:plan_decision', plan, app));
        executor.on('workflow:started', (plan) => this.emit('workflow:started', plan));
        executor.on('workflow:step_start', (s, p) => this.emit('workflow:step_start', s, p));
        executor.on('workflow:step_complete', (s, p) => this.emit('workflow:step_complete', s, p));
        executor.on('workflow:step_failed', (s, e, p) => this.emit('workflow:step_failed', s, e, p));
        executor.on('workflow:step_retry', (s, a, p) => this.emit('workflow:step_retry', s, a, p));
        executor.on('workflow:step_added', (s, p) => this.emit('workflow:step_added', s, p));
        executor.on('workflow:progress', (pr) => this.emit('workflow:progress', pr));
        executor.on('workflow:completed', (p, r) => this.emit('workflow:completed', p, r));
        executor.on('workflow:failed', (p, e) => this.emit('workflow:failed', p, e));
    }
}
