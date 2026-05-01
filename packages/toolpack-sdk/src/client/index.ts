import { EventEmitter } from 'events';
import { ProviderAdapter } from "../providers/base/index.js";
import { CompletionRequest, CompletionResponse, CompletionChunk, ToolCallRequest, ToolCallResult, EmbeddingRequest, EmbeddingResponse, ToolProgressEvent, ToolLogEvent, OnToolConfirmCallback, ToolConfirmationRequestedEvent, ToolConfirmationResolvedEvent, RequestToolDefinition, ContextWindowConfig, ProviderModelInfo } from "../types/index.js";
import { SDKError, ProviderError } from "../errors/index.js";
import { ContextWindowExceededError, SummarizationError } from '../errors/context-window-errors.js';
import { countTokens, getSafeOutputReserve } from '../utils/token-counter.js';
import { pruneMessages } from '../utils/message-pruner.js';
import { prepareSummarizationRequest, createSummarySystemMessage, parseSummarizationResponse, validateSummarizationResult } from '../utils/message-summarizer.js';
import { ContextWindowStateManager, createContextWindowStateManager } from '../utils/context-window-state.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolRouter } from '../tools/router.js';
import type { ToolsConfig, ToolSchema, ToolContext, ToolDefinition } from "../tools/types.js";
import { DEFAULT_TOOLS_CONFIG } from "../tools/types.js";
import type { HitlConfig } from '../providers/config.js';
import { ModeConfig } from '../modes/mode-types.js';
import { BM25SearchEngine, isToolSearchTool, getToolSearchSchema, generateToolCategoriesPrompt } from '../tools/search/index.js';
import { generateBaseAgentContext } from './base-agent-context.js';
import { QueryClassifier } from './query-classifier.js';
import { ToolOrchestrator } from './tool-orchestrator.js';
import { extractLastUserText } from '../utils/message-utils.js';
import { logInfo, logWarn, logError, logDebug, safePreview, shouldLog } from "../providers/provider-logger.js";

let REQUEST_SEQ = 0;

function newRequestId(): string {
    REQUEST_SEQ += 1;
    return `${Date.now()}-${REQUEST_SEQ}`;
}

function logRequestMessages(requestId: string, messages: CompletionRequest['messages']): void {
    if (!shouldLog('debug')) return;
    logDebug(`[AIClient][${requestId}] Messages (${messages.length}):`);
    messages.forEach((m, i) => {
        const preview = safePreview((m as any).content, 300);
        logDebug(`[AIClient][${requestId}]  #${i} role=${(m as any).role} content=${preview}`);
    });
}

interface EnrichedRequestResult {
    request: CompletionRequest;
    requestToolMap: Map<string, RequestToolDefinition>;
}

function inferNeedsTools(messages: CompletionRequest['messages']): boolean {
    const text = extractLastUserText(messages).toLowerCase();
    if (!text) return false;

    const patterns: RegExp[] = [
        /\b(list|show|print|display)\b.*\b(files|folders|directory|dir)\b/,
        /\b(current|this)\b.*\b(directory|folder|repo|repository)\b/,
        /\b(read|open|view)\b.*\b(file|log|config|json|yaml|env)\b/,
        /\b(write|create|update|modify|edit|patch|delete|remove|rename|move|copy)\b.*\b(file|folder|directory)\b/,
        /\b(run|execute)\b.*\b(command|shell|script|tests?)\b/,
        /\b(http|get|post|put|delete|download|fetch|curl)\b/,
        /\b(web|search|scrape|crawl|map)\b/,
        /https?:\/\//,  // Contains a URL
    ];

    return patterns.some(r => r.test(text));
}

function isAfterToolCall(messages: CompletionRequest['messages'], maxDistance: number): boolean {
    // Find the last tool call in the conversation
    let lastToolCallIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as any;
        if (msg.role === 'tool' || (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0)) {
            lastToolCallIndex = i;
            break;
        }
    }

    if (lastToolCallIndex === -1) return false;

    // Check if current message is within maxDistance messages after the tool call
    const distance = messages.length - 1 - lastToolCallIndex;
    return distance > 0 && distance <= maxDistance;
}

function getFastModelForProvider(providerName: string): string {
    const defaultFastModels: Record<string, string> = {
        openai: 'gpt-4.1-mini',
        anthropic: 'claude-3-haiku-20240307',
        gemini: 'gemini-2.0-flash-exp',
        ollama: 'llama3.2',
    };
    return defaultFastModels[providerName] || 'default';
}

function extractToolContext(messages: CompletionRequest['messages']): string {
    // Extract context from recent tool calls (last 2 tool rounds)
    const toolInfo: string[] = [];
    let toolRoundsFound = 0;

    for (let i = messages.length - 1; i >= 0 && toolRoundsFound < 2; i--) {
        const msg = messages[i] as any;

        // Extract from assistant's tool calls
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            toolRoundsFound++;
            for (const toolCall of msg.tool_calls) {
                const toolName = toolCall.function?.name || 'unknown';
                const args = toolCall.function?.arguments;

                // Extract relevant context from arguments
                let context = `Tool: ${toolName}`;
                if (args) {
                    try {
                        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
                        // Extract URLs, file paths, sections, queries
                        if (parsedArgs.url) context += ` (URL: ${parsedArgs.url})`;
                        if (parsedArgs.file_path) context += ` (File: ${parsedArgs.file_path})`;
                        if (parsedArgs.section) context += ` (Section: ${parsedArgs.section})`;
                        if (parsedArgs.query) context += ` (Query: ${parsedArgs.query})`;
                        if (parsedArgs.command) context += ` (Command: ${parsedArgs.command.substring(0, 50)})`;
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
                toolInfo.push(context);
            }
        }
    }

    return toolInfo.length > 0 ? toolInfo.join(', ') : 'None';
}

async function inferNeedsToolsWithAI(
    provider: ProviderAdapter,
    providerName: string,
    messages: CompletionRequest['messages'],
    fastModel: string
): Promise<boolean> {
    const requestId = newRequestId();
    logDebug(`[AIClient][${requestId}] inferNeedsToolsWithAI() provider=${providerName} model=${fastModel}`);

    // Extract tool context from recent tool calls
    const toolContext = extractToolContext(messages);

    // Get the last user message
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').slice(-1)[0] as any;
    const userMessage = lastUserMessage?.content || '';

    // Build context-aware prompt
    const prompt = `Recent tool usage: ${toolContext}

User's new message: "${userMessage}"

Does this message:
1. Ask about the same topic/context as recent tools? OR
2. Request new information that requires external tools (web search, file access, commands)?

If the message is general knowledge (math, definitions, explanations) or completely unrelated to recent tool context, answer NO.
If it asks about the same context OR needs new external information, answer YES.

Answer only: YES or NO`;

    try {
        const response = await provider.generate({
            model: fastModel,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 10,
            temperature: 0,
        });

        const answer = (response.content || '').trim().toUpperCase();
        const needsTools = answer.startsWith('YES');
        logDebug(`[AIClient][${requestId}] inferNeedsToolsWithAI() context="${toolContext}" message="${userMessage.substring(0, 50)}" result=${needsTools} (raw: ${answer})`);
        return needsTools;
    } catch (error) {
        logWarn(`[AIClient][${requestId}] inferNeedsToolsWithAI() error=${error} - falling back to false`);
        return false;
    }
}

function inferLookupOnly(messages: CompletionRequest['messages']): boolean {
    const text = extractLastUserText(messages).toLowerCase();
    if (!text) return false;

    const lookupPatterns: RegExp[] = [
        /\b(list|show|print|display)\b.*\b(files|folders|directory|dir)\b/,
        /\b(current|this)\b.*\b(directory|folder|repo|repository)\b/,
        /\b(read|open|view)\b.*\b(file|log|config|json|yaml|env)\b/,
    ];

    const mutatingPatterns: RegExp[] = [
        /\b(write|create|update|modify|edit|patch|delete|remove|rename|move|copy)\b/,
        /\b(run|execute)\b.*\b(command|shell|script|tests?)\b/,
        /\b(http|get|post|put|delete|download|fetch|curl)\b/,
        /\b(web|search|scrape|crawl)\b/,
    ];

    return lookupPatterns.some(r => r.test(text)) && !mutatingPatterns.some(r => r.test(text));
}

export interface AIClientConfig {
    providers: Record<string, ProviderAdapter>;
    defaultProvider?: string;
    toolRegistry?: ToolRegistry;
    toolsConfig?: ToolsConfig;
    systemPrompt?: string;
    disableBaseContext?: boolean;
    /** Human-in-the-loop configuration for tool confirmation */
    hitlConfig?: HitlConfig;
    /** Callback for handling tool confirmation requests */
    onToolConfirm?: OnToolConfirmCallback;
    /** Optional conversation ID for tracking context */
    conversationId?: string;
    /** Context window management configuration */
    contextWindowConfig?: ContextWindowConfig;
}

export class AIClient extends EventEmitter {
    private providers: Map<string, ProviderAdapter>;
    private defaultProvider?: string;
    private toolRegistry?: ToolRegistry;
    private toolsConfig: ToolsConfig;
    private toolRouter: ToolRouter;
    private bm25Engine: BM25SearchEngine;
    private queryClassifier: QueryClassifier;
    private toolOrchestrator: ToolOrchestrator;
    private activeMode: ModeConfig | null = null;
    private overrideSystemPrompt?: string;
    private disableBaseContext: boolean;
    private toolResultMaxChars: number;
    private hitlConfig?: HitlConfig;
    private onToolConfirm?: OnToolConfirmCallback;
    private currentRound: number = 0;
    private conversationId?: string;
    private contextWindowConfig?: ContextWindowConfig;
    private contextWindowStateManager?: ContextWindowStateManager;
    private providerModelCache: Map<string, ProviderModelInfo[]> = new Map();

    constructor(config: AIClientConfig) {
        super();
        this.providers = new Map(Object.entries(config.providers));
        this.defaultProvider = config.defaultProvider;
        this.toolRegistry = config.toolRegistry;
        this.toolsConfig = config.toolsConfig || DEFAULT_TOOLS_CONFIG;
        this.toolRouter = new ToolRouter();
        this.bm25Engine = new BM25SearchEngine();
        this.queryClassifier = new QueryClassifier();
        this.toolOrchestrator = new ToolOrchestrator();
        this.overrideSystemPrompt = config.systemPrompt;
        this.disableBaseContext = config.disableBaseContext || false;
        const configuredMax = this.toolsConfig.resultMaxChars ?? DEFAULT_TOOLS_CONFIG.resultMaxChars ?? 20_000;
        this.toolResultMaxChars = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 20_000;
        this.hitlConfig = config.hitlConfig;
        this.onToolConfirm = config.onToolConfirm;
        this.conversationId = config.conversationId;
        this.contextWindowConfig = config.contextWindowConfig;
        this.providerModelCache = new Map();

        // Initialize context window state manager if config provided
        if (this.contextWindowConfig && this.contextWindowConfig.enabled !== false) {
            this.contextWindowStateManager = createContextWindowStateManager(this.contextWindowConfig);
        }

        // Index tools for BM25 search if registry is provided
        if (this.toolRegistry) {
            this.bm25Engine.index(this.toolRegistry.getAll());
        }
    }

    private getConversationId(): string {
        return this.conversationId || 'global';
    }

    private async getModelInfo(provider: ProviderAdapter, model: string): Promise<ProviderModelInfo | undefined> {
        const providerKey = (provider as any).name || provider.constructor.name;
        let models = this.providerModelCache.get(providerKey);
        if (!models) {
            try {
                models = await provider.getModels();
            } catch {
                models = [];
            }
            this.providerModelCache.set(providerKey, models);
        }

        return models.find(m => m.id === model || m.displayName === model);
    }

    private async countRequestTokens(request: CompletionRequest, provider: ProviderAdapter, model: string): Promise<number> {
        const providerCount = await provider.countTokens(request.messages, model);
        if (typeof providerCount === 'number' && Number.isFinite(providerCount)) {
            return providerCount;
        }

        return countTokens(request.messages, model, provider.getDisplayName().toLowerCase());
    }

    private async pruneConversation(request: CompletionRequest, provider: ProviderAdapter, targetTokenCount: number): Promise<CompletionRequest> {
        const retainSystemMessages = this.contextWindowConfig?.retainSystemMessages ?? true;
        let currentRequest = request;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const currentTokens = await this.countRequestTokens(currentRequest, provider, currentRequest.model);
            if (currentTokens <= targetTokenCount) {
                return currentRequest;
            }

            const tokensToRecover = currentTokens - targetTokenCount;
            const result = pruneMessages(currentRequest.messages, tokensToRecover, retainSystemMessages);
            const removedSet = new Set(result.pruneInfo.removedMessages);
            const filteredMessages = currentRequest.messages.filter(msg => !removedSet.has(msg));
            const filteredRequest = { ...currentRequest, messages: filteredMessages };

            if (this.contextWindowStateManager) {
                this.contextWindowStateManager.recordPruneOperation(this.getConversationId(), result.tokensReclaimed);
            }

            const newTokenCount = await this.countRequestTokens(filteredRequest, provider, filteredRequest.model);
            if (newTokenCount <= targetTokenCount || filteredMessages.length === currentRequest.messages.length) {
                return filteredRequest;
            }
            currentRequest = filteredRequest;
        }

        return request;
    }

    private async pruneToMaxMessageHistory(request: CompletionRequest): Promise<CompletionRequest> {
        const maxLength = this.contextWindowConfig?.maxMessageHistoryLength;
        if (!maxLength || request.messages.length <= maxLength) {
            return request;
        }

        const retainSystemMessages = this.contextWindowConfig?.retainSystemMessages ?? true;
        const prunableIndexes: number[] = [];
        request.messages.forEach((msg, idx) => {
            if (retainSystemMessages && msg.role === 'system') return;
            if (msg.role === 'tool') return;
            prunableIndexes.push(idx);
        });

        const removeCount = Math.max(0, request.messages.length - maxLength);
        if (removeCount === 0) {
            return request;
        }

        const removeIndexes = new Set(prunableIndexes.slice(0, removeCount));
        const filteredMessages = request.messages.filter((_, idx) => !removeIndexes.has(idx));
        return { ...request, messages: filteredMessages };
    }

    private async summarizeConversation(request: CompletionRequest, provider: ProviderAdapter): Promise<CompletionRequest> {
        const messages = request.messages;
        const systemMessages = messages.filter(m => m.role === 'system');
        const nonSystemMessages = messages.filter(m => m.role !== 'system');

        if (nonSystemMessages.length < 4) {
            return request;
        }

        const recentMessages = nonSystemMessages.slice(-4);
        const messagesToSummarize = nonSystemMessages.slice(0, -4);
        if (messagesToSummarize.length < 2) {
            return request;
        }

        const summarizerModel = this.contextWindowConfig?.summarizerModel || request.model;
        const summaryRequestMessages = prepareSummarizationRequest(messagesToSummarize, {
            model: summarizerModel,
            maxSummaryTokens: 500,
        });

        const summaryResponse = await provider.generate({
            model: summarizerModel,
            messages: summaryRequestMessages,
            max_tokens: 500,
            temperature: 0,
            response_format: 'text',
        });

        if (!summaryResponse.content) {
            throw new SummarizationError('Summarization provider returned no summary', this.getConversationId(), messagesToSummarize.length, 'invalid_response');
        }

        const originalTokenCount = await this.countRequestTokens({ ...request, messages: messagesToSummarize }, provider, summarizerModel);
        const summarization = parseSummarizationResponse(summaryResponse.content, messagesToSummarize, originalTokenCount);
        const validation = validateSummarizationResult(summarization);

        if (!validation.valid) {
            throw new SummarizationError(`Summarization result is invalid: ${validation.issues.join('; ')}`, this.getConversationId(), messagesToSummarize.length, 'invalid_quality', summaryResponse.content);
        }

        const summaryMessage = createSummarySystemMessage(summarization.summary, messagesToSummarize.length);
        const summarizedMessages = [...systemMessages, summaryMessage, ...recentMessages];

        if (this.contextWindowStateManager) {
            this.contextWindowStateManager.recordSummarization(this.getConversationId(), summarization.tokensSaved);
        }

        return { ...request, messages: summarizedMessages };
    }

    private async enforceContextWindow(request: CompletionRequest, provider: ProviderAdapter): Promise<CompletionRequest> {
        if (!this.contextWindowConfig || this.contextWindowConfig.enabled === false) {
            return request;
        }

        let managedRequest = await this.pruneToMaxMessageHistory(request);
        const modelInfo = await this.getModelInfo(provider, managedRequest.model);
        const contextWindow = modelInfo?.contextWindow ?? 100000;
        const maxOutputTokens = managedRequest.max_tokens ?? modelInfo?.maxOutputTokens ?? 1024;
        const outputBuffer = this.contextWindowConfig.outputTokenBuffer ?? 1.15;
        const reserve = getSafeOutputReserve(maxOutputTokens, outputBuffer);
        const safeInputLimit = Math.max(0, contextWindow - reserve);
        const configuredThreshold = Math.floor(contextWindow * ((this.contextWindowConfig.pruneThreshold ?? 85) / 100));
        const triggerThreshold = Math.min(safeInputLimit, configuredThreshold);

        const currentTokens = await this.countRequestTokens(managedRequest, provider, managedRequest.model);
        if (this.contextWindowStateManager) {
            this.contextWindowStateManager.updateTokenCount(this.getConversationId(), currentTokens);
            if (currentTokens > triggerThreshold) {
                this.contextWindowStateManager.recordWarning(this.getConversationId());
            }
        }

        if (currentTokens <= triggerThreshold) {
            return managedRequest;
        }

        const strategy = this.contextWindowConfig.strategy ?? 'prune';

        if (strategy === 'fail' && currentTokens > safeInputLimit) {
            throw new ContextWindowExceededError(`Context window exceeded by request messages`, this.getConversationId(), currentTokens, safeInputLimit, strategy);
        }

        if (strategy === 'summarize') {
            try {
                const summarizedRequest = await this.summarizeConversation(managedRequest, provider);
                const summarizedTokens = await this.countRequestTokens(summarizedRequest, provider, summarizedRequest.model);
                if (summarizedTokens <= safeInputLimit) {
                    return summarizedRequest;
                }
                managedRequest = await this.pruneConversation(summarizedRequest, provider, safeInputLimit);
            } catch (error) {
                managedRequest = await this.pruneConversation(managedRequest, provider, safeInputLimit);
            }
        } else {
            managedRequest = await this.pruneConversation(managedRequest, provider, safeInputLimit);
        }

        const finalTokens = await this.countRequestTokens(managedRequest, provider, managedRequest.model);
        if (finalTokens > safeInputLimit) {
            if (strategy === 'fail') {
                throw new ContextWindowExceededError(`Context window exceeded after attempted cleanup`, this.getConversationId(), finalTokens, safeInputLimit, strategy);
            }
        }

        return managedRequest;
    }

    /**
     * Check if a tool should bypass confirmation based on HITL config.
     * Returns true if the tool should execute without confirmation.
     */
    private isBypassed(tool: ToolDefinition): boolean {
        const hitl = this.hitlConfig;

        // If HITL config doesn't exist, bypass everything
        if (!hitl) return true;

        // If HITL is explicitly disabled, bypass everything
        if (hitl.enabled === false) return true;

        // Check confirmation mode
        const mode = hitl.confirmationMode ?? 'all';
        if (mode === 'off') return true;
        if (mode === 'high-only' && tool.confirmation?.level === 'medium') return true;

        // Check bypass rules
        const bypass = hitl.bypass ?? {};
        if (bypass.tools?.includes(tool.name)) return true;
        if (bypass.categories?.includes(tool.category)) return true;
        if (tool.confirmation && bypass.levels?.includes(tool.confirmation.level)) return true;

        return false;
    }

    /**
     * Register a new provider instance.
     */
    registerProvider(name: string, provider: ProviderAdapter) {
        this.providers.set(name, provider);
    }

    /**
     * Get a provider by name, or the default if none specified.
     */
    getProvider(name?: string): ProviderAdapter {
        const providerName = name || this.defaultProvider;
        if (!providerName) {
            throw new SDKError('No provider specified and no default provider configured', 'NO_PROVIDER_CONFIGURED', 400);
        }
        const provider = this.providers.get(providerName);
        if (!provider) {
            throw new SDKError(`Provider '${providerName}' not found`, 'PROVIDER_NOT_FOUND', 404);
        }
        return provider;
    }

    /**
     * Update the HITL configuration dynamically.
     * This allows modifying bypass rules without restarting the client.
     */
    updateHitlConfig(config: HitlConfig): void {
        this.hitlConfig = config;
    }

    /**
     * Get the current HITL configuration.
     */
    getHitlConfig(): HitlConfig | undefined {
        return this.hitlConfig;
    }

    /**
     * Set the default provider for this client.
     */
    setDefaultProvider(name: string): void {
        if (!this.providers.has(name)) {
            throw new SDKError(`Provider '${name}' not found`, 'PROVIDER_NOT_FOUND', 404);
        }
        this.defaultProvider = name;
    }

    /**
     * Get the tool registry.
     */
    getToolRegistry(): ToolRegistry | undefined {
        return this.toolRegistry;
    }

    /**
     * Get all registered providers.
     * Returns a copy of the internal map to prevent direct mutation.
     */
    getProviders(): Map<string, ProviderAdapter> {
        return new Map(this.providers);
    }

    /**
     * Set or replace the tool registry.
     */
    setToolRegistry(registry: ToolRegistry): void {
        this.toolRegistry = registry;
    }

    /**
     * Update tools config.
     */
    setToolsConfig(config: ToolsConfig): void {
        this.toolsConfig = config;
    }

    /**
     * Set the override system prompt directly via code.
     */
    setSystemPrompt(prompt: string | undefined): void {
        this.overrideSystemPrompt = prompt;
    }

    /**
     * Set the active mode. Pass null to clear.
     */
    setMode(mode: ModeConfig | null): void {
        this.activeMode = mode;
        logInfo(`[AIClient] Mode set to: ${mode ? mode.displayName : 'none (cleared)'}`);
    }

    /**
     * Get the currently active mode.
     */
    getMode(): ModeConfig | null {
        return this.activeMode;
    }

    /**
     * Get the query classifier instance.
     */
    getQueryClassifier(): QueryClassifier {
        return this.queryClassifier;
    }

    /**
     * Re-index tools for BM25 search.
     * Call this after adding/removing tools from the registry.
     */
    reindexTools(): void {
        if (this.toolRegistry) {
            this.bm25Engine.index(this.toolRegistry.getAll());
            logInfo(`[AIClient] Re-indexed ${this.bm25Engine.getIndexedCount()} tools for BM25 search`);
        }
    }

    /**
     * Clear the tool discovery cache (call when starting a new conversation).
     */
    clearToolDiscoveryCache(): void {
        this.toolRouter.clearDiscoveryCache();
    }

    /**
     * unified generate completion
     * When tools are enabled and autoExecute is true, handles the full
     * tool call → execute → send result → get final answer loop.
     */
    async generate(request: CompletionRequest, providerName?: string): Promise<CompletionResponse> {
        const provider = this.getProvider(providerName);
        try {
            const requestId = newRequestId();

            // System prompt injection chain (base → override → mode)
            let modeAwareRequest = this.injectBaseAgentContext(request);
            modeAwareRequest = this.injectOverrideSystemPrompt(modeAwareRequest);
            modeAwareRequest = this.injectModeSystemPrompt(modeAwareRequest);

            // Resolve tools to send with the request
            const resolvedProviderName = providerName || this.defaultProvider;
            const initialEnrichment = await this.enrichRequestWithTools(modeAwareRequest);
            let enrichedRequest = initialEnrichment.request;
            const requestToolMap = initialEnrichment.requestToolMap;
            enrichedRequest = await this.enforceContextWindow(enrichedRequest, provider);

            const policy = (process.env.TOOLPACK_SDK_TOOL_CHOICE_POLICY || this.toolsConfig.toolChoicePolicy || 'auto') as any;
            const hasTools = (enrichedRequest.tools?.length || 0) > 0;
            const toolChoiceWasSet = (enrichedRequest as any).tool_choice != null;

            // Hybrid tool detection: regex first, then AI for follow-ups
            let needsTools = inferNeedsTools(enrichedRequest.messages);
            const intelligentDetection = this.toolsConfig.intelligentToolDetection;
            let aiInferenceUsed = false;

            if (!needsTools && intelligentDetection?.enabled && hasTools) {
                const afterToolCall = isAfterToolCall(enrichedRequest.messages, intelligentDetection.maxFollowUpMessages);
                if (afterToolCall) {
                    logInfo(`[AIClient][${requestId}] Message is after tool call, using AI to infer tool needs`);
                    const fastModel = getFastModelForProvider(resolvedProviderName || 'openai');
                    needsTools = await inferNeedsToolsWithAI(provider, resolvedProviderName || 'openai', enrichedRequest.messages, fastModel);
                    aiInferenceUsed = true;
                }
            }

            const lookupOnly = inferLookupOnly(enrichedRequest.messages);

            const shouldForceRequired = !toolChoiceWasSet && hasTools && (
                policy === 'required' || (policy === 'required_for_actions' && needsTools)
            );

            const shouldForceNone = !toolChoiceWasSet && hasTools && aiInferenceUsed && !needsTools;

            if (shouldForceRequired) {
                (enrichedRequest as any).tool_choice = 'required';
            } else if (shouldForceNone) {
                (enrichedRequest as any).tool_choice = 'none';
                logInfo(`[AIClient][${requestId}] AI inference determined no tools needed, setting tool_choice=none`);
            }

            const providerClass = (provider as any)?.constructor?.name || 'UnknownProvider';
            const outboundReq: any = { ...this.stripRequestTools(enrichedRequest), __toolpack_request_id: requestId };

            logInfo(`[AIClient][${requestId}] generate() start provider=${resolvedProviderName} class=${providerClass} model=${enrichedRequest.model} messages=${enrichedRequest.messages.length} tools=${enrichedRequest.tools?.length || 0} tool_choice=${(enrichedRequest as any).tool_choice ?? 'unset'} policy=${policy} needsTools=${needsTools} autoExecute=${this.toolsConfig.enabled && this.toolsConfig.autoExecute}`);
            logRequestMessages(requestId, enrichedRequest.messages);

            let response = await provider.generate(outboundReq);

            logDebug(`[AIClient][${requestId}] generate() initial response finish_reason=${(response as any).finish_reason ?? 'unknown'} tool_calls=${response.tool_calls?.length || 0} content_preview=${safePreview(response.content || '', 200)}`);

            // Auto-execute tool call loop
            if (this.toolsConfig.autoExecute && (this.toolRegistry || requestToolMap.size > 0)) {
                // Classify query to adjust maxToolRounds
                const userMessage = extractLastUserText(enrichedRequest.messages);
                const classification = this.queryClassifier.classify(userMessage);
                const baseMaxRounds = this.toolsConfig.maxToolRounds;
                const maxRounds = this.queryClassifier.getToolRoundsAdjustment(classification, baseMaxRounds);

                if (maxRounds !== baseMaxRounds) {
                    logInfo(`[AIClient][${requestId}] Query classified as ${classification.type} (confidence: ${classification.confidence.toFixed(2)}), adjusted maxToolRounds: ${baseMaxRounds} → ${maxRounds}`);
                } else {
                    logDebug(`[AIClient][${requestId}] Query classified as ${classification.type} (confidence: ${classification.confidence.toFixed(2)}), keeping maxToolRounds: ${maxRounds}`);
                }

                let rounds = 0;
                const messages = [...enrichedRequest.messages];

                if (response.tool_calls && response.tool_calls.length > 0) {
                    logInfo(`[AIClient] Received ${response.tool_calls.length} tool call(s): ${response.tool_calls.map(tc => tc.name).join(', ')}`);
                }

                while (response.tool_calls && response.tool_calls.length > 0 && rounds < maxRounds) {
                    rounds++;
                    this.currentRound = rounds;
                    logInfo(`[AIClient][${requestId}] generate() tool round ${rounds}/${maxRounds} tool_calls=${response.tool_calls.length}`);

                    // Add assistant message with tool calls to conversation
                    messages.push({
                        role: 'assistant',
                        content: response.content || '',
                        tool_calls: response.tool_calls.map(tc => ({
                            id: tc.id,
                            type: 'function' as const,
                            function: {
                                name: tc.name,
                                arguments: JSON.stringify(tc.arguments),
                            },
                        })),
                    });

                    // Execute tools with smart parallel/sequential orchestration
                    const useParallel = this.toolOrchestrator.shouldUseParallelExecution(response.tool_calls);

                    // Apply fan-out limits for web.fetch to prevent context overflow
                    const MAX_WEB_FETCH_CALLS = 3;
                    let toolCallsToExecute = response.tool_calls;
                    const webFetchCalls = response.tool_calls.filter(tc => tc.name === 'web.fetch');
                    if (webFetchCalls.length > MAX_WEB_FETCH_CALLS) {
                        logInfo(`[AIClient][${requestId}] Limiting web.fetch calls from ${webFetchCalls.length} → ${MAX_WEB_FETCH_CALLS} to prevent context overflow`);
                        const limitedWebFetch = webFetchCalls.slice(0, MAX_WEB_FETCH_CALLS);
                        const otherCalls = response.tool_calls.filter(tc => tc.name !== 'web.fetch');
                        toolCallsToExecute = [...otherCalls, ...limitedWebFetch];

                        // Add placeholder responses for excluded web.fetch calls to avoid orphaned tool_call_ids
                        const excludedWebFetch = webFetchCalls.slice(MAX_WEB_FETCH_CALLS);
                        for (const tc of excludedWebFetch) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: '[Skipped: web.fetch fan-out limit exceeded]',
                            });
                        }
                    }

                    // Track tool output budget for this round
                    const MAX_TOOL_OUTPUT_PER_ROUND = 50_000;
                    let roundOutputSize = 0;

                    if (useParallel) {
                        logInfo(`[AIClient][${requestId}] Using parallel execution for ${toolCallsToExecute.length} tools`);
                        const toolResults = await this.toolOrchestrator.executeWithDependencies(
                            toolCallsToExecute,
                            (toolCall) => this.executeTool(toolCall, requestToolMap),
                            5 // maxConcurrent
                        );

                        // Add results in original order with budget tracking
                        let parallelBudgetExceeded = false;
                        for (const toolCall of toolCallsToExecute) {
                            if (parallelBudgetExceeded) {
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: '[Skipped: tool output budget exceeded for this round]',
                                });
                                continue;
                            }

                            const result = toolResults.get(toolCall.id)!;
                            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                            // Check budget before adding
                            if (roundOutputSize + resultStr.length > MAX_TOOL_OUTPUT_PER_ROUND) {
                                logWarn(`[AIClient][${requestId}] Tool output budget exceeded (${MAX_TOOL_OUTPUT_PER_ROUND} chars), adding placeholder for remaining tools`);
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: '[Skipped: tool output budget exceeded for this round]',
                                });
                                parallelBudgetExceeded = true;
                                continue;
                            }

                            const content = typeof result === 'string' && result.length > this.toolResultMaxChars
                                ? `${result.slice(0, this.toolResultMaxChars)}\n[TRUNCATED tool result: ${result.length} chars]`
                                : result;

                            const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                            roundOutputSize += contentStr.length;

                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content,
                            });
                        }
                        logDebug(`[AIClient][${requestId}] Round tool output size: ${roundOutputSize} chars (budget: ${MAX_TOOL_OUTPUT_PER_ROUND})`);
                    } else {
                        logInfo(`[AIClient][${requestId}] Using sequential execution for ${toolCallsToExecute.length} tools`);
                        // Sequential execution with budget tracking
                        let seqBudgetExceeded = false;
                        for (const toolCall of toolCallsToExecute) {
                            if (seqBudgetExceeded) {
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: '[Skipped: tool output budget exceeded for this round]',
                                });
                                continue;
                            }

                            const result = await this.executeTool(toolCall, requestToolMap);
                            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                            // Check budget before adding
                            if (roundOutputSize + resultStr.length > MAX_TOOL_OUTPUT_PER_ROUND) {
                                logWarn(`[AIClient][${requestId}] Tool output budget exceeded (${MAX_TOOL_OUTPUT_PER_ROUND} chars), adding placeholder for remaining tools`);
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: '[Skipped: tool output budget exceeded for this round]',
                                });
                                seqBudgetExceeded = true;
                                continue;
                            }

                            const content = typeof result === 'string' && result.length > this.toolResultMaxChars
                                ? `${result.slice(0, this.toolResultMaxChars)}\n[TRUNCATED tool result: ${result.length} chars]`
                                : result;

                            const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                            roundOutputSize += contentStr.length;

                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content,
                            });
                        }
                        logDebug(`[AIClient][${requestId}] Round tool output size: ${roundOutputSize} chars (budget: ${MAX_TOOL_OUTPUT_PER_ROUND})`);
                    }

                    // Call the model again with updated messages
                    const rawFollowupReq: any = { ...enrichedRequest, messages, __toolpack_request_id: requestId };
                    // Re-enrich to include any tools discovered in the previous round
                    let followupReq = this.stripRequestTools((await this.enrichRequestWithTools(rawFollowupReq)).request);
                    followupReq = await this.enforceContextWindow(followupReq, provider);

                    if ((followupReq as any).tool_choice === 'required') {
                        (followupReq as any).tool_choice = lookupOnly ? 'none' : 'auto';
                        logInfo(`[AIClient][${requestId}] generate() followup tool_choice override required->${(followupReq as any).tool_choice}`);
                    }
                    if (shouldLog('debug')) {
                        logDebug(`[AIClient][${requestId}] generate() followup request messages=${messages.length}`);
                        logRequestMessages(requestId, messages);
                    }
                    response = await provider.generate(followupReq);
                    logDebug(`[AIClient][${requestId}] generate() followup response finish_reason=${(response as any).finish_reason ?? 'unknown'} tool_calls=${response.tool_calls?.length || 0} content_preview=${safePreview(response.content || '', 200)}`);
                }
            }

            return response;
        } catch (error) {
            throw this.wrapError(error);
        }
    }

    /**
     * unified stream completion
     * When tools are enabled and autoExecute is true, handles tool calls
     * by collecting them, executing, and re-calling the model.
     */
    async *stream(request: CompletionRequest, providerName?: string): AsyncGenerator<CompletionChunk> {
        const provider = this.getProvider(providerName);
        try {
            const requestId = newRequestId();
            const resolvedProviderName = providerName || this.defaultProvider;

            // System prompt injection chain (base → override → mode)
            let modeAwareRequest = this.injectBaseAgentContext(request);
            modeAwareRequest = this.injectOverrideSystemPrompt(modeAwareRequest);
            modeAwareRequest = this.injectModeSystemPrompt(modeAwareRequest);

            const initialEnrichment = await this.enrichRequestWithTools(modeAwareRequest);
            let enrichedRequest = initialEnrichment.request;
            const requestToolMap = initialEnrichment.requestToolMap;
            enrichedRequest = await this.enforceContextWindow(enrichedRequest, provider);

            const policy = (process.env.TOOLPACK_SDK_TOOL_CHOICE_POLICY || this.toolsConfig.toolChoicePolicy || 'auto') as any;
            const hasTools = (enrichedRequest.tools?.length || 0) > 0;
            const toolChoiceWasSet = (enrichedRequest as any).tool_choice != null;

            // Hybrid tool detection: regex first, then AI for follow-ups
            let needsTools = inferNeedsTools(enrichedRequest.messages);
            const intelligentDetection = this.toolsConfig.intelligentToolDetection;
            let aiInferenceUsed = false;

            if (!needsTools && intelligentDetection?.enabled && hasTools) {
                const afterToolCall = isAfterToolCall(enrichedRequest.messages, intelligentDetection.maxFollowUpMessages);
                if (afterToolCall) {
                    logInfo(`[AIClient][${requestId}] Message is after tool call, using AI to infer tool needs`);
                    const fastModel = getFastModelForProvider(resolvedProviderName || 'openai');
                    needsTools = await inferNeedsToolsWithAI(provider, resolvedProviderName || 'openai', enrichedRequest.messages, fastModel);
                    aiInferenceUsed = true;
                }
            }

            const lookupOnly = inferLookupOnly(enrichedRequest.messages);

            const shouldForceRequired = !toolChoiceWasSet && hasTools && (
                policy === 'required' || (policy === 'required_for_actions' && needsTools)
            );

            const shouldForceNone = !toolChoiceWasSet && hasTools && aiInferenceUsed && !needsTools;

            if (shouldForceRequired) {
                (enrichedRequest as any).tool_choice = 'required';
            } else if (shouldForceNone) {
                (enrichedRequest as any).tool_choice = 'none';
                logInfo(`[AIClient][${requestId}] AI inference determined no tools needed, setting tool_choice=none`);
            }

            const providerClass = (provider as any)?.constructor?.name || 'UnknownProvider';
            const baseReq: any = { ...this.stripRequestTools(enrichedRequest), __toolpack_request_id: requestId };

            logInfo(`[AIClient][${requestId}] stream() start provider=${resolvedProviderName} class=${providerClass} model=${enrichedRequest.model} messages=${enrichedRequest.messages.length} tools=${enrichedRequest.tools?.length || 0} tool_choice=${(enrichedRequest as any).tool_choice ?? 'unset'} policy=${policy} needsTools=${needsTools} autoExecute=${this.toolsConfig.enabled && this.toolsConfig.autoExecute}`);
            logRequestMessages(requestId, enrichedRequest.messages);

            if (!this.toolsConfig.autoExecute || (!this.toolRegistry && requestToolMap.size === 0)) {
                yield* provider.stream(baseReq);
                return;
            }

            const messages = [...enrichedRequest.messages];
            let rounds = 0;

            // Classify query to adjust maxToolRounds (same as generate())
            const userMessage = extractLastUserText(enrichedRequest.messages);
            const classification = this.queryClassifier.classify(userMessage);
            const baseMaxRounds = this.toolsConfig.maxToolRounds;
            const maxRounds = this.queryClassifier.getToolRoundsAdjustment(classification, baseMaxRounds);

            if (maxRounds !== baseMaxRounds) {
                logInfo(`[AIClient][${requestId}] stream() Query classified as ${classification.type} (confidence: ${classification.confidence.toFixed(2)}), adjusted maxToolRounds: ${baseMaxRounds} → ${maxRounds}`);
            }

            while (rounds <= maxRounds) {
                // Check for abort signal at start of each round
                if (request.signal?.aborted) {
                    logInfo(`[AIClient][${requestId}] stream() aborted by signal`);
                    return;
                }

                let accumulatedContent = '';
                const pendingToolCalls: ToolCallResult[] = [];

                rounds++;
                this.currentRound = rounds;
                logInfo(`[AIClient][${requestId}] stream() round_start ${rounds}/${maxRounds}`);
                let lastFinishReason: string | null = null;

                const rawRoundReq: any = { ...enrichedRequest, messages };
                // Re-enrich to include any newly discovered tools from previous rounds
                let roundReq = this.stripRequestTools((await this.enrichRequestWithTools(rawRoundReq)).request);
                roundReq = await this.enforceContextWindow(roundReq, provider);

                if (rounds > 0 && (roundReq as any).tool_choice === 'required') {
                    (roundReq as any).tool_choice = lookupOnly ? 'none' : 'auto';
                    logInfo(`[AIClient][${requestId}] stream() round_${rounds + 1} tool_choice override required->${(roundReq as any).tool_choice}`);
                }

                for await (const chunk of provider.stream(roundReq)) {
                    // Check for abort signal during streaming
                    if (request.signal?.aborted) {
                        logInfo(`[AIClient][${requestId}] stream() aborted by signal during chunk processing`);
                        return;
                    }

                    if (chunk.tool_calls && chunk.tool_calls.length > 0) {
                        pendingToolCalls.push(...chunk.tool_calls);
                        logDebug(`[AIClient][${requestId}] stream() tool_calls_chunk count=${chunk.tool_calls.length} names=${chunk.tool_calls.map(tc => tc.name).join(', ')}`);
                        // Yield tool calls in the chunk so consumers can track them
                        yield chunk;
                    }
                    if (chunk.delta) {
                        accumulatedContent += chunk.delta;
                        yield chunk;
                    }
                    if (chunk.finish_reason) {
                        lastFinishReason = chunk.finish_reason as any;
                    }
                    if (chunk.finish_reason === 'stop') {
                        yield chunk;
                    }
                }

                logDebug(`[AIClient][${requestId}] stream() round_end finish_reason=${lastFinishReason ?? 'unknown'} accumulated_len=${accumulatedContent.length} tool_calls_total=${pendingToolCalls.length} content_preview=${safePreview(accumulatedContent, 200)}`);

                // If no tool calls, we're done
                if (pendingToolCalls.length === 0) {
                    break;
                }

                logInfo(`[AIClient][${requestId}] stream() received ${pendingToolCalls.length} tool call(s): ${pendingToolCalls.map(tc => tc.name).join(', ')}`);

                rounds++;
                if (rounds > maxRounds) {
                    logInfo(`[AIClient][${requestId}] stream() max tool rounds (${maxRounds}) reached`);
                    break;
                }
                logInfo(`[AIClient][${requestId}] stream() tool round ${rounds}/${maxRounds}`);

                // Add assistant message and tool results to conversation
                messages.push({
                    role: 'assistant',
                    content: accumulatedContent || '',
                    tool_calls: pendingToolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                    })),
                });

                // Apply fan-out limits for web.fetch to prevent context overflow
                const MAX_WEB_FETCH_CALLS = 3;
                let toolCallsToExecute = pendingToolCalls;
                const webFetchCalls = pendingToolCalls.filter(tc => tc.name === 'web.fetch');
                if (webFetchCalls.length > MAX_WEB_FETCH_CALLS) {
                    logInfo(`[AIClient][${requestId}] Limiting web.fetch calls from ${webFetchCalls.length} → ${MAX_WEB_FETCH_CALLS} to prevent context overflow`);
                    const limitedWebFetch = webFetchCalls.slice(0, MAX_WEB_FETCH_CALLS);
                    const otherCalls = pendingToolCalls.filter(tc => tc.name !== 'web.fetch');
                    toolCallsToExecute = [...otherCalls, ...limitedWebFetch];

                    // Add placeholder responses for excluded web.fetch calls to avoid orphaned tool_call_ids
                    const excludedWebFetch = webFetchCalls.slice(MAX_WEB_FETCH_CALLS);
                    for (const tc of excludedWebFetch) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: '[Skipped: web.fetch fan-out limit exceeded]',
                        });
                    }
                }

                // Track tool output budget for this round
                const MAX_TOOL_OUTPUT_PER_ROUND = 50_000;
                let roundOutputSize = 0;

                let budgetExceeded = false;
                // Collect heartbeat chunks to yield while tools execute
                const heartbeatChunks: { delta: '' }[] = [];
                for (const toolCall of toolCallsToExecute) {
                    if (budgetExceeded) {
                        // Still must add a tool response for every tool_call to satisfy OpenAI API
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: '[Skipped: tool output budget exceeded for this round]',
                        });
                        continue;
                    }

                    const startTime = Date.now();

                    // Execute tool with heartbeat: yield empty chunks periodically
                    // so UI consumers (e.g. terminal animations) stay alive
                    let toolDone = false;
                    const heartbeatInterval = setInterval(() => {
                        if (!toolDone) heartbeatChunks.push({ delta: '' });
                    }, 500);

                    const result = await this.executeTool(toolCall, requestToolMap);
                    toolDone = true;
                    clearInterval(heartbeatInterval);
                    const duration = Date.now() - startTime;

                    // Yield any queued heartbeat chunks
                    while (heartbeatChunks.length > 0) {
                        yield heartbeatChunks.shift()!;
                    }
                    // Extra yield point for event loop
                    await new Promise(resolve => setTimeout(resolve, 0));

                    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                    // Check budget before adding
                    if (roundOutputSize + resultStr.length > MAX_TOOL_OUTPUT_PER_ROUND) {
                        logWarn(`[AIClient][${requestId}] Tool output budget exceeded (${MAX_TOOL_OUTPUT_PER_ROUND} chars), adding placeholder for remaining tools`);
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: '[Skipped: tool output budget exceeded for this round]',
                        });
                        budgetExceeded = true;
                        continue;
                    }

                    const content = typeof result === 'string' && result.length > this.toolResultMaxChars
                        ? `${result.slice(0, this.toolResultMaxChars)}\n[TRUNCATED tool result: ${result.length} chars]`
                        : result;

                    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                    roundOutputSize += contentStr.length;

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content,
                    });

                    // Yield a chunk with the tool result so consumers can track it
                    yield {
                        delta: '',
                        tool_calls: [{
                            ...toolCall,
                            result: typeof content === 'string' ? content : JSON.stringify(content),
                            duration,
                        }],
                    };
                }

                logDebug(`[AIClient][${requestId}] Round tool output size: ${roundOutputSize} chars (budget: ${MAX_TOOL_OUTPUT_PER_ROUND})`);


                if (shouldLog('debug')) {
                    logDebug(`[AIClient][${requestId}] stream() after_tools messages=${messages.length}`);
                    logRequestMessages(requestId, messages);
                }
            }
        } catch (error) {
            throw this.wrapError(error);
        }
    }

    /**
     * unified embed
     */
    async embed(request: EmbeddingRequest, providerName?: string): Promise<EmbeddingResponse> {
        const provider = this.getProvider(providerName);
        try {
            return await provider.embed(request);
        } catch (error) {
            throw this.wrapError(error);
        }
    }

    /**
     * Enrich a request with tools based on the router config.
     * Applies mode-based tool filtering when an active mode is set.
     */
    private async enrichRequestWithTools(request: CompletionRequest): Promise<EnrichedRequestResult> {
        // If mode blocks ALL tools, return request with no tools
        if (this.activeMode?.blockAllTools) {
            logInfo(`[AIClient] Mode "${this.activeMode.displayName}" blocks all tools`);
            return { request, requestToolMap: new Map() };
        }

        const requestToolMap = this.buildRequestToolMap(request.requestTools);
        const requestToolSchemas = Array.from(requestToolMap.values()).map(tool => this.requestToolToSchema(tool));
        const hasRequestTools = requestToolMap.size > 0;

        if (!this.toolsConfig.enabled && !hasRequestTools) {
            logDebug(`[AIClient] Tools disabled and no request-scoped tools`);
            return { request, requestToolMap };
        }

        // Merge mode-specific tool search config with global config
        let resolvedToolsConfig = this.toolsConfig;
        if (this.activeMode?.toolSearch && this.toolsConfig.toolSearch) {
            resolvedToolsConfig = {
                ...this.toolsConfig,
                toolSearch: {
                    ...this.toolsConfig.toolSearch,
                    ...(this.activeMode.toolSearch.enabled !== undefined ? { enabled: this.activeMode.toolSearch.enabled } : {}),
                    ...(this.activeMode.toolSearch.alwaysLoadedTools ? { alwaysLoadedTools: this.activeMode.toolSearch.alwaysLoadedTools } : {}),
                    ...(this.activeMode.toolSearch.alwaysLoadedCategories ? { alwaysLoadedCategories: this.activeMode.toolSearch.alwaysLoadedCategories } : {}),
                }
            };
            logDebug(`[AIClient] Merged mode toolSearch config: enabled=${resolvedToolsConfig.toolSearch?.enabled}, alwaysLoadedTools=${resolvedToolsConfig.toolSearch?.alwaysLoadedTools?.length || 0}`);
        }

        // If the request already has tools, only add newly discovered tools when tool.search mode is enabled
        if (request.tools && request.tools.length > 0) {
            if (!resolvedToolsConfig.toolSearch?.enabled || !this.toolRegistry) {
                logDebug(`[AIClient] Request already has ${request.tools.length} tools`);
                const tools = this.mergeToolCallRequests(request.tools, this.schemasToToolCallRequests(requestToolSchemas));
                const nextRequest = tools === request.tools ? request : { ...request, tools };
                return {
                    request: this.injectRequestToolGuidance(nextRequest, tools),
                    requestToolMap,
                };
            }

            let schemas = await this.toolRouter.resolve(
                request.messages,
                this.toolRegistry,
                resolvedToolsConfig,
            );

            logDebug(`[AIClient] Resolved ${schemas.length} tools to send: ${schemas.map(s => s.name).join(', ') || 'none'}`);

            if (this.activeMode && schemas.length > 0) {
                const beforeCount = schemas.length;
                schemas = this.filterSchemasByMode(schemas, this.activeMode);
                const filteredCount = beforeCount - schemas.length;
                if (filteredCount > 0) {
                    logInfo(`[AIClient] Mode "${this.activeMode.displayName}" filtered out ${filteredCount} tools`);
                }
            }

            const existingToolNames = new Set(request.tools.map(tool => tool.function.name));
            const newTools: ToolCallRequest[] = schemas
                .filter(schema => !existingToolNames.has(schema.name))
                .map(schema => ({
                    type: 'function',
                    function: {
                        name: schema.name,
                        description: schema.description,
                        parameters: schema.parameters,
                    },
                }));

            if (newTools.length === 0) {
                logDebug(`[AIClient] Request already has ${request.tools.length} tools (no new discoveries)`);
                const tools = this.mergeToolCallRequests(request.tools, this.schemasToToolCallRequests(requestToolSchemas));
                const nextRequest = tools === request.tools ? request : { ...request, tools };
                return {
                    request: this.injectRequestToolGuidance(nextRequest, tools),
                    requestToolMap,
                };
            }

            let enrichedRequest: CompletionRequest = {
                ...request,
                tools: this.mergeToolCallRequests(
                    [...request.tools, ...newTools],
                    this.schemasToToolCallRequests(requestToolSchemas)
                ),
            };

            if (resolvedToolsConfig.toolSearch?.enabled && this.toolRegistry) {
                enrichedRequest = this.injectToolSearchPrompt(enrichedRequest);
            }

            return {
                request: this.injectRequestToolGuidance(enrichedRequest, enrichedRequest.tools),
                requestToolMap,
            };
        }

        if (!this.toolRegistry) {
            logDebug('[AIClient] Tool registry not configured, skipping tool resolution');
            const tools = this.schemasToToolCallRequests(requestToolSchemas);
            const nextRequest = tools.length > 0 ? { ...request, tools } : request;
            return {
                request: this.injectRequestToolGuidance(nextRequest, tools),
                requestToolMap,
            };
        }

        const activeRegistry = this.toolRegistry;

        let schemas = await this.toolRouter.resolve(
            request.messages,
            activeRegistry,
            resolvedToolsConfig,
        );

        logDebug(`[AIClient] Resolved ${schemas.length} tools to send: ${schemas.map(s => s.name).join(', ') || 'none'}`);

        // Apply mode-based filtering
        if (this.activeMode && schemas.length > 0) {
            const beforeCount = schemas.length;
            schemas = this.filterSchemasByMode(schemas, this.activeMode);
            const filteredCount = beforeCount - schemas.length;
            if (filteredCount > 0) {
                logInfo(`[AIClient] Mode "${this.activeMode.displayName}" filtered out ${filteredCount} tools`);
            }
        }

        const tools = this.schemasToToolCallRequests(this.mergeSchemas(schemas, requestToolSchemas));

        if (tools.length === 0) {
            return { request, requestToolMap };
        }

        let enrichedRequest: CompletionRequest = { ...request, tools };

        // Inject Tool Search system prompt if enabled
        if (this.toolsConfig.toolSearch?.enabled && activeRegistry) {
            enrichedRequest = this.injectToolSearchPrompt(enrichedRequest);
        }

        return {
            request: this.injectRequestToolGuidance(enrichedRequest, tools),
            requestToolMap,
        };
    }

    private buildRequestToolMap(requestTools?: RequestToolDefinition[]): Map<string, RequestToolDefinition> {
        const map = new Map<string, RequestToolDefinition>();
        for (const tool of requestTools || []) {
            map.set(tool.name, tool);
        }
        return map;
    }

    private requestToolToSchema(tool: RequestToolDefinition): ToolSchema {
        return {
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            parameters: tool.parameters as any,
            category: tool.category,
            cacheable: tool.cacheable,
        };
    }

    private mergeSchemas(base: ToolSchema[], overrides: ToolSchema[]): ToolSchema[] {
        const merged = new Map<string, ToolSchema>();
        for (const schema of base) {
            merged.set(schema.name, schema);
        }
        for (const schema of overrides) {
            merged.set(schema.name, schema);
        }
        return Array.from(merged.values());
    }

    private schemasToToolCallRequests(schemas: ToolSchema[]): ToolCallRequest[] {
        return schemas.map(schema => ({
            type: 'function',
            function: {
                name: schema.name,
                description: schema.description,
                parameters: schema.parameters,
            },
        }));
    }

    private mergeToolCallRequests(base: ToolCallRequest[], overrides: ToolCallRequest[]): ToolCallRequest[] {
        if (overrides.length === 0) {
            return base;
        }
        const merged = new Map<string, ToolCallRequest>();
        for (const tool of base) {
            merged.set(tool.function.name, tool);
        }
        for (const tool of overrides) {
            merged.set(tool.function.name, tool);
        }
        return Array.from(merged.values());
    }

    private injectRequestToolGuidance(request: CompletionRequest, effectiveTools?: ToolCallRequest[]): CompletionRequest {
        const toolNames = new Set((effectiveTools || request.tools || []).map(tool => tool.function.name));
        if (toolNames.size === 0) {
            return request;
        }

        // Use a marker to detect if guidance has already been injected
        const GUIDANCE_MARKER = '<!-- TOOLPACK_REQUEST_TOOL_GUIDANCE -->';
        
        const sections: string[] = [];

        if (toolNames.has('knowledge_search') || toolNames.has('knowledge_add')) {
            const lines = ['Knowledge Base:'];
            if (toolNames.has('knowledge_search')) {
                lines.push('- Use `knowledge_search` when you need factual or domain-specific information that may already be stored.');
            }
            if (toolNames.has('knowledge_add')) {
                lines.push('- Use `knowledge_add` when you encounter a durable fact, user preference, or decision that future conversations should know. Do not add confidential information, routine task outputs, or context that is specific to this conversation only.');
            }
            sections.push(lines.join('\n'));
        }

        if (toolNames.has('conversation_search')) {
            sections.push(
                'Conversation History:\n- Only recent messages may be present in context.\n- Use `conversation_search` to find relevant details from earlier in this conversation when needed.'
            );
        }

        if (sections.length === 0) {
            return request;
        }

        const guidance = `${GUIDANCE_MARKER}\n${sections.join('\n\n')}`;
        const systemIndex = request.messages.findIndex(message => message.role === 'system');

        if (systemIndex >= 0) {
            const messages = request.messages.map((message, index) => {
                if (index !== systemIndex) return message;
                const existingContent = typeof message.content === 'string' ? message.content : '';
                
                // Check for marker instead of full text for more robust deduplication
                if (existingContent.includes(GUIDANCE_MARKER)) {
                    return message; // Already injected
                }
                
                return {
                    ...message,
                    content: `${existingContent}\n\n${guidance}`.trim(),
                };
            });
            return { ...request, messages };
        }

        return {
            ...request,
            messages: [{ role: 'system', content: guidance }, ...request.messages],
        };
    }

    private stripRequestTools(request: CompletionRequest): CompletionRequest {
        const { requestTools, ...rest } = request;
        void requestTools;
        return rest;
    }

    /**
     * Filter tool schemas based on mode permissions.
     * blockedTools/blockedToolCategories always take precedence.
     */
    private filterSchemasByMode(schemas: ToolSchema[], mode: ModeConfig): ToolSchema[] {
        return schemas.filter(schema => {
            // Check explicit blocks first (highest priority)
            if (mode.blockedTools.includes(schema.name)) return false;
            if (mode.blockedToolCategories.includes(schema.category)) return false;

            // Keep tool.search available in tool-search mode even when category allowlists are restrictive.
            // Explicit blocks above still win.
            if (isToolSearchTool(schema.name)) {
                const toolSearchEnabledInMode = mode.toolSearch?.enabled;
                const toolSearchEnabled =
                    toolSearchEnabledInMode !== undefined
                        ? toolSearchEnabledInMode
                        : (this.toolsConfig.toolSearch?.enabled ?? false);

                if (toolSearchEnabled) {
                    return true;
                }
            }

            // If allowlists are specified, tool must match at least one
            const hasAllowedTools = mode.allowedTools.length > 0;
            const hasAllowedCategories = mode.allowedToolCategories.length > 0;

            if (hasAllowedTools || hasAllowedCategories) {
                const nameAllowed = hasAllowedTools && mode.allowedTools.includes(schema.name);
                const categoryAllowed = hasAllowedCategories && mode.allowedToolCategories.includes(schema.category);
                return nameAllowed || categoryAllowed;
            }

            // No allowlists = everything is allowed (minus blocks)
            return true;
        });
    }

    /**
     * Inject the active mode's system prompt into the request messages.
     * For the "All" mode (empty systemPrompt), this is a no-op.
     */
    private injectModeSystemPrompt(request: CompletionRequest): CompletionRequest {
        if (!this.activeMode || !this.activeMode.systemPrompt) {
            logDebug(`[AIClient] injectModeSystemPrompt: No active mode or empty systemPrompt. activeMode=${this.activeMode?.name}, systemPrompt=${this.activeMode?.systemPrompt?.substring(0, 50)}`);
            return request;
        }

        const modePrompt = this.activeMode.systemPrompt;
        logDebug(`[AIClient] injectModeSystemPrompt: Injecting mode prompt for ${this.activeMode.name}, length=${modePrompt.length}`);
        const hasSystemMessage = request.messages.some(m => m.role === 'system');

        if (hasSystemMessage) {
            // Prepend mode prompt to existing system message
            const messages = request.messages.map(m => {
                if (m.role === 'system') {
                    const existingContent = typeof m.content === 'string' ? m.content : '';
                    return {
                        ...m,
                        content: `${existingContent}\n\n${modePrompt}`
                    };
                }
                return m;
            });
            return { ...request, messages };
        } else {
            return {
                ...request,
                messages: [
                    { role: 'system', content: modePrompt },
                    ...request.messages
                ]
            };
        }
    }

    /**
     * Inject the overriding system prompt (from AIClientConfig) into the request.
     */
    private injectOverrideSystemPrompt(request: CompletionRequest): CompletionRequest {
        if (!this.overrideSystemPrompt) {
            return request;
        }

        const prompt = this.overrideSystemPrompt;
        const hasSystemMessage = request.messages.some(m => m.role === 'system');

        if (hasSystemMessage) {
            const messages = request.messages.map(m => {
                if (m.role === 'system') {
                    const existingContent = typeof m.content === 'string' ? m.content : '';
                    return {
                        ...m,
                        content: `${existingContent}\n\n${prompt}`
                    };
                }
                return m;
            });
            return { ...request, messages };
        } else {
            return {
                ...request,
                messages: [{ role: 'system', content: prompt }, ...request.messages]
            };
        }
    }

    /**
     * Inject the Base Agent Context into the request.
     * Tells the agent its CWD, tools, and to be proactive.
     */
    private injectBaseAgentContext(request: CompletionRequest): CompletionRequest {
        // Check if active mode has per-mode baseContext config
        let includeWd = true;
        let includeCategories = true;
        let customContext: string | undefined;
        const disabled = this.disableBaseContext;

        if (this.activeMode?.baseContext === false) {
            // Mode explicitly disables base context entirely
            return request;
        } else if (this.activeMode?.baseContext) {
            // Mode has fine-grained base context config
            includeWd = this.activeMode.baseContext.includeWorkingDirectory !== false;
            includeCategories = this.activeMode.baseContext.includeToolCategories !== false;
            customContext = this.activeMode.baseContext.custom;
        }

        const baseContext = customContext || generateBaseAgentContext({
            workingDirectory: process.cwd(),
            toolCategories: this.toolRegistry ? this.toolRegistry.getCategories() : [],
            disabled,
            includeWorkingDirectory: includeWd,
            includeToolCategories: includeCategories,
        });

        if (!baseContext) {
            return request;
        }

        const hasSystemMessage = request.messages.some(m => m.role === 'system');

        if (hasSystemMessage) {
            const messages = request.messages.map(m => {
                if (m.role === 'system') {
                    const existingContent = typeof m.content === 'string' ? m.content : '';
                    return {
                        ...m,
                        content: `${baseContext}\n\n${existingContent}`
                    };
                }
                return m;
            });
            return { ...request, messages };
        } else {
            return {
                ...request,
                messages: [{ role: 'system', content: baseContext }, ...request.messages]
            };
        }
    }

    /**
     * Inject Tool Search system prompt to guide AI to use tool.search.
     */
    private injectToolSearchPrompt(request: CompletionRequest): CompletionRequest {
        if (!this.toolRegistry) return request;

        // Check if system message already exists
        const hasSystemMessage = request.messages.some(m => m.role === 'system');

        // Build list of always-loaded tools for context
        const alwaysLoadedTools = this.toolsConfig.toolSearch?.alwaysLoadedTools ?? [];
        let alwaysLoadedSection = '';
        if (alwaysLoadedTools.length > 0) {
            const toolDescriptions = alwaysLoadedTools
                .map(name => {
                    const tool = this.toolRegistry?.get(name);
                    return tool ? `  - **${tool.name}**: ${tool.description}` : null;
                })
                .filter(Boolean)
                .join('\n');
            
            if (toolDescriptions) {
                alwaysLoadedSection = `\n\nYou have these tools always available:\n${toolDescriptions}\n\nUse these tools directly when appropriate for the task.`;
            }
        }

        const toolSearchInstructions = `
IMPORTANT: Tool Discovery Instructions

You have access to a limited set of tools. If you need a tool that is not in your current list, you MUST use the 'tool.search' tool to discover it.${alwaysLoadedSection}

${generateToolCategoriesPrompt(this.toolRegistry)}

When you need a tool:
1. Check if it's in your current tool list
2. If NOT found, call tool.search with a descriptive query (e.g., "delete file", "run command", "http request")
3. After discovering tools, you can call them directly in subsequent turns

NEVER guess or hallucinate tool names. ALWAYS use tool.search to discover tools you don't have.
`.trim();

        if (hasSystemMessage) {
            // Append to existing system message
            const messages = request.messages.map(m => {
                if (m.role === 'system') {
                    const existingContent = typeof m.content === 'string' ? m.content : '';
                    return {
                        ...m,
                        content: `${existingContent}\n\n${toolSearchInstructions}`
                    };
                }
                return m;
            });
            return { ...request, messages };
        } else {
            // Prepend new system message
            return {
                ...request,
                messages: [
                    { role: 'system', content: toolSearchInstructions },
                    ...request.messages
                ]
            };
        }
    }

    /**
     * Execute a single tool call via the registry.
     * Emits 'tool:started', 'tool:completed', and 'tool:failed' events.
     */
    private async executeTool(toolCall: ToolCallResult, requestToolMap: Map<string, RequestToolDefinition>): Promise<string> {
        const startTime = Date.now();

        // Emit started event
        this.emit('tool:started', {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            status: 'started',
            args: toolCall.arguments,
        } as ToolProgressEvent);

        logInfo(`[AIClient] Executing tool: ${toolCall.name} with args: ${safePreview(toolCall.arguments, 500)}`);

        const requestTool = requestToolMap.get(toolCall.name);
        const registryTool = requestTool ? undefined : this.toolRegistry?.get(toolCall.name);

        if (!requestTool && !this.toolRegistry) {
            const error = 'No tool registry configured';
            this.emit('tool:failed', {
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                status: 'failed',
                error,
                duration: Date.now() - startTime,
            } as ToolProgressEvent);
            return JSON.stringify({ error });
        }

        // Special handling for tool.search (BM25 search)
        if (isToolSearchTool(toolCall.name)) {
            const result = this.executeToolSearch(toolCall.arguments);
            const duration = Date.now() - startTime;
            this.emit('tool:completed', {
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                status: 'completed',
                result: typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result).substring(0, 200),
                duration,
            } as ToolProgressEvent);

            // Emit log event for tool.search
            this.emit('tool:log', {
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                result,
                duration,
                status: 'success',
                timestamp: Date.now(),
            } as ToolLogEvent);
            return result;
        }

        const tool = requestTool || registryTool;
        if (!tool) {
            logWarn(`[AIClient] Tool '${toolCall.name}' not found in registry`);

            // Fuzzy match: detect common hallucination patterns
            const suggestion = this.findSimilarToolName(toolCall.name);
            const errorMsg = suggestion
                ? `Tool '${toolCall.name}' not found. Did you mean '${suggestion}'? Use tool.search to discover available tools.`
                : `Tool '${toolCall.name}' not found. Use tool.search to discover available tools.`;

            this.emit('tool:failed', {
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                status: 'failed',
                error: errorMsg,
                duration: Date.now() - startTime,
            } as ToolProgressEvent);

            return JSON.stringify({ error: errorMsg });
        }

        try {
            let args = toolCall.arguments;

            // Human-in-the-loop confirmation check
            if (registryTool?.confirmation && this.onToolConfirm && !this.isBypassed(registryTool)) {
                // Emit confirmation requested event
                this.emit('tool:confirmation_requested', {
                    tool: registryTool,
                    args,
                    level: registryTool.confirmation.level,
                    reason: registryTool.confirmation.reason,
                } as ToolConfirmationRequestedEvent);

                // Wait for user decision
                const decision = await this.onToolConfirm(registryTool, args, {
                    roundNumber: this.currentRound,
                    conversationId: this.conversationId,
                });

                // Emit confirmation resolved event
                this.emit('tool:confirmation_resolved', {
                    tool: registryTool,
                    args,
                    level: registryTool.confirmation.level,
                    reason: registryTool.confirmation.reason,
                    decision,
                } as ToolConfirmationResolvedEvent);

                // Handle decision
                if (decision.action === 'deny') {
                    const denyMsg = `[Execution denied by user${decision.reason ? ': ' + decision.reason : ''}]`;
                    const duration = Date.now() - startTime;
                    this.emit('tool:completed', {
                        toolName: toolCall.name,
                        toolCallId: toolCall.id,
                        status: 'completed',
                        result: denyMsg,
                        duration,
                    } as ToolProgressEvent);
                    this.emit('tool:log', {
                        id: toolCall.id,
                        name: toolCall.name,
                        arguments: args,
                        result: denyMsg,
                        duration,
                        status: 'success',
                        timestamp: Date.now(),
                    } as ToolLogEvent);
                    return denyMsg;
                }

                if (decision.action === 'modify') {
                    args = decision.args;
                }
                // 'allow' falls through to execution
            }

            const ctx: ToolContext = {
                workspaceRoot: process.cwd(),
                config: this.toolsConfig?.additionalConfigurations ?? {},
                log: (msg) => logInfo(`[Tool] ${msg}`),
            };
            const result = requestTool
                ? await requestTool.execute(args)
                : await tool.execute(args, ctx);
            const duration = Date.now() - startTime;

            // Emit completed event
            this.emit('tool:completed', {
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                status: 'completed',
                result: typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result).substring(0, 200),
                duration,
            } as ToolProgressEvent);

            // Emit log event with full details for history/logging
            this.emit('tool:log', {
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                result,
                duration,
                status: 'success',
                timestamp: Date.now(),
            } as ToolLogEvent);

            const resultLength = typeof result === 'string' ? result.length : JSON.stringify(result).length;
            logInfo(`[AIClient] Tool ${toolCall.name} executed successfully in ${duration}ms result_len=${resultLength}`);
            if (shouldLog('debug')) {
                logDebug(`[AIClient] Tool ${toolCall.name} result_preview=${safePreview(result, 400)}`);
            }
            return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            const errorMsg = error.message || 'Tool execution failed';

            // Emit failed event
            this.emit('tool:failed', {
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                status: 'failed',
                error: errorMsg,
                duration,
            } as ToolProgressEvent);

            // Emit log event for errors too
            this.emit('tool:log', {
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                result: JSON.stringify({ error: errorMsg }),
                duration,
                status: 'error',
                timestamp: Date.now(),
            } as ToolLogEvent);

            logError(`[AIClient] Tool ${toolCall.name} failed: ${safePreview(errorMsg, 300)}`);
            return JSON.stringify({ error: errorMsg });
        }
    }

    /**
     * Find similar tool name to detect hallucinations.
     * Detects common patterns like underscore vs dot (fs_delete_file vs fs.delete_file).
     */
    private findSimilarToolName(hallucinatedName: string): string | null {
        if (!this.toolRegistry) return null;

        const allTools = this.toolRegistry.getAll();

        // Pattern 1: underscore → dot (fs_delete_file → fs.delete_file)
        const withDot = hallucinatedName.replace(/_/g, '.');
        if (allTools.some(t => t.name === withDot)) {
            return withDot;
        }

        // Pattern 2: dot → underscore (fs.delete.file → fs.delete_file)
        const withUnderscore = hallucinatedName.replace(/\./g, '_');
        if (allTools.some(t => t.name === withUnderscore)) {
            return withUnderscore;
        }

        // Pattern 3: camelCase → dot.case (fsDeleteFile → fs.delete_file)
        const fromCamelCase = hallucinatedName
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .toLowerCase()
            .replace(/_/g, '.');
        if (allTools.some(t => t.name === fromCamelCase)) {
            return fromCamelCase;
        }

        // Pattern 4: Levenshtein distance for typos
        let bestMatch: string | null = null;
        let minDistance = Infinity;

        for (const tool of allTools) {
            const distance = this.levenshteinDistance(hallucinatedName.toLowerCase(), tool.name.toLowerCase());
            // Only suggest if very close (1-2 character difference)
            if (distance <= 2 && distance < minDistance) {
                minDistance = distance;
                bestMatch = tool.name;
            }
        }

        return bestMatch;
    }

    /**
     * Calculate Levenshtein distance between two strings.
     */
    private levenshteinDistance(a: string, b: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Execute tool.search using BM25 engine.
     */
    private executeToolSearch(args: Record<string, any>): string {
        const { query, category } = args;
        const limit = this.toolsConfig.toolSearch?.searchResultLimit ?? 5;
        const requestedCategory = typeof category === 'string' && category.length > 0 ? category : undefined;

        if (this.activeMode) {
            const searchAllowed = this.filterSchemasByMode([getToolSearchSchema()], this.activeMode).length > 0;
            if (!searchAllowed) {
                logWarn('[AIClient] tool.search blocked by active mode');
                return JSON.stringify({
                    query,
                    found: 0,
                    tools: [],
                    hint: 'tool.search is not allowed in the current mode.',
                });
            }
        }

        logInfo(`[AIClient] Executing tool.search: query="${query}" category=${requestedCategory || 'all'} limit=${limit}`);

        // Oversample so mode filtering (allowed/blocked tools and categories) does not starve the
        // final result set when allowlists are restrictive. We slice down to the configured limit below.
        const oversampleLimit = this.activeMode ? Math.max(limit * 4, limit) : limit;
        let results = this.bm25Engine.search(query, { limit: oversampleLimit, category: requestedCategory });

        if (this.activeMode && results.length > 0) {
            const allowedSchemas = this.filterSchemasByMode(results.map(result => result.tool), this.activeMode);
            const allowedToolNames = new Set(allowedSchemas.map(schema => schema.name));
            const beforeCount = results.length;

            results = results.filter(result => allowedToolNames.has(result.toolName));

            const filteredCount = beforeCount - results.length;
            if (filteredCount > 0) {
                logDebug(`[AIClient] tool.search filtered out ${filteredCount} disallowed results for mode "${this.activeMode.displayName}"`);
            }
        }

        if (results.length > limit) {
            results = results.slice(0, limit);
        }

        // Record discovered tools in the cache
        const toolNames = results.map(r => r.toolName);
        this.toolRouter.getDiscoveryCache().recordDiscovery(query, toolNames);

        logDebug(`[AIClient] tool.search found ${results.length} tools: ${toolNames.join(', ') || 'none'}`);

        return JSON.stringify({
            query,
            found: results.length,
            tools: results.map(r => ({
                name: r.tool.name,
                displayName: r.tool.displayName,
                description: r.tool.description,
                category: r.tool.category,
                parameters: r.tool.parameters,
                relevanceScore: Math.round(r.score * 100) / 100,
            })),
            hint: results.length > 0
                ? `Found ${results.length} tools. You can now call any of these tools directly.`
                : `No tools found for "${query}". Try a different search term.`,
        });
    }

    private wrapError(error: any): SDKError {
        if (error instanceof SDKError) {
            return error;
        }
        return new ProviderError(error.message || 'Unknown provider error', 'UNKNOWN_PROVIDER_ERROR', 500, error);
    }
}
