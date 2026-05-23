import { EventEmitter } from 'events';
import { AIClient } from '../client/index.js';
import { CompletionRequest } from '../types/index.js';
import { WorkflowConfig, WorkflowResult, WorkflowProgress } from './workflow-types.js';
import { Plan } from './planning/plan-types.js';
import { Planner } from './planning/planner.js';
import { QueryClassifier } from '../client/query-classifier.js';
import { extractLastUserText } from '../utils/message-utils.js';
import { logDebug, logInfo, logWarn } from '../providers/provider-logger.js';

export class WorkflowExecutor extends EventEmitter {
    private client: AIClient;
    private config: WorkflowConfig;
    private planner: Planner;
    private queryClassifier: QueryClassifier;

    // For approval flow
    private pendingApprovals = new Map<string, (approved: boolean) => void>();

    constructor(client: AIClient, config: WorkflowConfig, queryClassifier?: QueryClassifier) {
        super();
        this.client = client;
        this.config = config;
        this.queryClassifier = queryClassifier || new QueryClassifier();
        this.planner = new Planner(client, config.planning);
    }

    /**
     * Get the active configuration.
     */
    getConfig(): WorkflowConfig {
        return this.config;
    }

    /**
     * Update the configuration.
     */
    setConfig(config: WorkflowConfig): void {
        this.config = config;
        this.planner = new Planner(this.client, config.planning);
    }

    /**
     * Determine if a query should bypass full workflow and use direct execution.
     * Routes simple queries to single-step execution for performance optimization.
     */
    private shouldRouteSimpleQuery(request: CompletionRequest): boolean {
        // Check if complexity routing is enabled
        if (!this.config.complexityRouting?.enabled) {
            return false;
        }

        // Strategy 'bypass' means always skip workflow when routing kicks in
        // Strategy 'single-step' routes to executeDirect (which preserves workflow events)
        const strategy = this.config.complexityRouting.strategy ?? 'single-step';
        if (strategy === 'disabled') {
            return false;
        }

        // Extract user message and classify
        const userMessage = extractLastUserText(request.messages);
        if (!userMessage) {
            return false;
        }

        const classification = this.queryClassifier.classify(userMessage);
        const threshold = this.config.complexityRouting.confidenceThreshold ?? 0.6;

        // Routing logic: type-primary, confidence-secondary
        // - action: always full workflow (high-stakes operations)
        // - conversational: always single-step (definitionally simple Q&A)
        // - analytical: confidence-based (≥threshold = single-step, <threshold = full workflow)

        let shouldRoute = false;

        switch (classification.type) {
            case 'action':
                // Action queries are high-stakes — never route
                shouldRoute = false;
                break;

            case 'conversational':
                // Conversational queries are simple by definition — always route
                shouldRoute = true;
                break;

            case 'analytical':
                // Analytical queries use confidence threshold
                shouldRoute = classification.confidence >= threshold;
                break;
        }

        logDebug(`[Workflow] shouldRouteSimpleQuery() type=${classification.type} confidence=${classification.confidence.toFixed(2)} threshold=${threshold} shouldRoute=${shouldRoute} strategy=${strategy}`);

        return shouldRoute;
    }

    /**
     * Execute a request using the configured workflow.
     *
     * Modes:
     *   - Direct:       no planning — single generate() call
     *   - Plan-direct:  planning generates a roadmap, then executes in one generate() call
     */
    async execute(request: CompletionRequest, providerName?: string): Promise<WorkflowResult> {
        // Check query complexity routing first
        if (this.shouldRouteSimpleQuery(request)) {
            return this.executeDirect(request, providerName);
        }

        const planningEnabled = this.config.planning?.enabled;

        logDebug(`[Workflow] execute() planningEnabled=${planningEnabled} provider=${providerName ?? 'default'}`);

        // No planning — direct execution
        if (!planningEnabled) {
            logDebug('[Workflow] execute() mode=direct');
            return this.executeDirect(request, providerName);
        }

        // Planning enabled — create plan then execute in one generate() call
        logDebug('[Workflow] execute() mode=plan-direct — creating plan');
        const plan = await this.createPlan(request, providerName);
        this.emit('workflow:plan_created', plan);

        // If approval required, pause and wait
        if (this.config.planning?.requireApproval) {
            logInfo(`[Workflow] Plan "${plan.id}" requires approval — waiting`);
            this.emitProgress(plan, 'awaiting_approval', 'Waiting for plan approval');
            const approved = await this.waitForApproval(plan.id);
            this.emit('workflow:plan_decision', plan, approved);

            if (!approved) {
                logInfo(`[Workflow] Plan "${plan.id}" rejected by user`);
                plan.status = 'cancelled';
                this.emitProgress(plan, 'failed', 'Plan rejected by user');
                return {
                    success: false,
                    plan,
                    error: 'Plan rejected by user',
                    metrics: { totalDuration: 0, stepsCompleted: 0, stepsFailed: 0, retriesUsed: 0 },
                };
            }
            logInfo(`[Workflow] Plan "${plan.id}" approved`);
        }

        plan.status = 'approved';
        return this.executePlanDirect(plan, request, providerName);
    }

    /**
     * Direct execution — current SDK behavior, wrapped in WorkflowResult.
     */
    private async executeDirect(request: CompletionRequest, providerName?: string): Promise<WorkflowResult> {
        const startTime = Date.now();
        const plan = this.createDummyPlan(request);
        logDebug(`[Workflow] executeDirect() provider=${providerName ?? 'default'}`);

        try {
            this.emitProgress(plan, 'executing', 'Direct execution');
            const response = await this.client.generate(request, providerName);

            // Update plan inline for accurate returned result
            plan.status = 'completed';
            plan.completedAt = new Date();
            plan.steps[0]!.status = 'completed';

            const duration = Date.now() - startTime;
            logDebug(`[Workflow] executeDirect() completed in ${duration}ms content_len=${response.content?.length ?? 0}`);

            const result: WorkflowResult = {
                success: true,
                plan,
                output: response.content || undefined,
                response,
                metrics: {
                    totalDuration: Date.now() - startTime,
                    stepsCompleted: 1,
                    stepsFailed: 0,
                    retriesUsed: 0,
                },
            };

            this.emit('workflow:completed', plan, result);
            this.emitProgress(plan, 'completed', 'Done');
            return result;
        } catch (error) {
            plan.status = 'failed';
            plan.completedAt = new Date();
            plan.steps[0]!.status = 'failed';

            logWarn(`[Workflow] executeDirect() failed: ${(error as Error).message}`);

            const result: WorkflowResult = {
                success: false,
                plan,
                error: (error as Error).message,
                metrics: {
                    totalDuration: Date.now() - startTime,
                    stepsCompleted: 0,
                    stepsFailed: 1,
                    retriesUsed: 0,
                },
            };

            this.emit('workflow:failed', plan, error as Error);
            this.emitProgress(plan, 'failed', 'Execution failed');
            return result;
        }
    }

    /**
     * Create a plan from the request.
     */
    private async createPlan(request: CompletionRequest, providerName?: string): Promise<Plan> {
        logDebug(`[Workflow] createPlan() provider=${providerName ?? 'default'}`);
        const draft = this.createDummyPlan(request);
        draft.status = 'draft';
        this.emitProgress(draft, 'planning', 'Creating plan...');

        const plan = await this.planner.createPlan(request, providerName);
        logInfo(`[Workflow] createPlan() completed plan.id=${plan.id} steps=${plan.steps.length}`);
        return plan;
    }

    /**
     * Planning without steps — inject plan as context prefix and execute in one generate() call.
     * The LLM sees its own roadmap and uses it to guide tool usage and sequencing.
     */
    private async executePlanDirect(plan: Plan, baseRequest: CompletionRequest, providerName?: string): Promise<WorkflowResult> {
        const startTime = Date.now();
        plan.status = 'in_progress';
        plan.startedAt = new Date();
        this.emit('workflow:started', plan);
        // Plan-direct executes atomically — no per-step progress is available.
        // Emit 10% to signal we've left the planning phase and execution has begun.
        this.emitProgress(plan, 'executing', 'Executing plan', 10);
        logDebug(`[Workflow] executePlanDirect() plan.id=${plan.id} steps=${plan.steps.length} provider=${providerName ?? 'default'}`);

        // Inject the plan as system context.
        // If baseRequest already has a leading system message (e.g., a mode system prompt),
        // merge the plan context into it rather than prepending a second system message,
        // which many providers either reject or handle inconsistently.
        const planContext = `
You have created the following plan to fulfill the request:
Summary: ${plan.summary}

Steps:
${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}

Execute this plan now.
        `.trim();

        const messages = this.injectPlanContext(baseRequest.messages, planContext);

        const request: CompletionRequest = {
            ...baseRequest,
            messages,
        };

        try {
            const response = await this.client.generate(request, providerName);

            // Mark all steps completed since it was evaluated in one go
            plan.steps.forEach(s => {
                s.status = 'completed';
                s.result = { success: true, output: response.content || '', response };
            });

            plan.status = 'completed';
            plan.completedAt = new Date();
            plan.metrics = this.computeMetrics(plan, startTime, 0);

            logDebug(`[Workflow] executePlanDirect() completed plan.id=${plan.id} duration=${Date.now() - startTime}ms`);

            const result: WorkflowResult = {
                success: true,
                plan,
                output: response.content || undefined,
                response,
                metrics: plan.metrics as any,
            };

            this.emit('workflow:completed', plan, result);
            this.emitProgress(plan, 'completed', 'Done');
            return result;

        } catch (error) {
            plan.status = 'failed';
            plan.completedAt = new Date();

            logWarn(`[Workflow] executePlanDirect() failed plan.id=${plan.id}: ${(error as Error).message}`);

            const result: WorkflowResult = {
                success: false,
                plan,
                error: (error as Error).message,
                metrics: this.computeMetrics(plan, startTime, 0) as any,
            };

            this.emit('workflow:failed', plan, error as Error);
            this.emitProgress(plan, 'failed', 'Execution failed');
            return result;
        }
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Emit a progress event.
     * @param percentageOverride - Optional fixed percentage (0–100). Use for plan-direct
     *   mode where steps complete atomically and intermediate step-level progress is unavailable.
     */
    private emitProgress(
        plan: Plan,
        statusStr?: WorkflowProgress['status'],
        overrideDesc?: string,
        percentageOverride?: number,
    ): void {
        if (!this.config.progress?.enabled) {
            return;
        }

        const totalSteps = plan.steps.length;
        const completedSteps = plan.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
        const percentage = percentageOverride ?? (totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0);

        const progress: WorkflowProgress = {
            planId: plan.id,
            currentStep: Math.min(completedSteps + 1, totalSteps),
            totalSteps,
            percentage,
            currentStepDescription: overrideDesc ?? (plan.steps[completedSteps]?.description ?? 'Done'),
            status: statusStr ?? 'executing',
        };

        this.emit('workflow:progress', progress);
    }

    /**
     * Compute metrics for the plan.
     */
    private computeMetrics(plan: Plan, startTime: number, retriesUsed: number) {
        return {
            totalDuration: Date.now() - startTime,
            stepsCompleted: plan.steps.filter(s => s.status === 'completed').length,
            stepsFailed: plan.steps.filter(s => s.status === 'failed').length,
            retriesUsed,
        };
    }

    /**
     * Create a dummy plan for internal representation when no plan is generated.
     */
    private createDummyPlan(request: CompletionRequest): Plan {
        const userText = request.messages
            .filter(m => m.role === 'user')
            .map(m => typeof m.content === 'string' ? m.content : '[Object]')
            .join('\n');

        return {
            id: `plan-direct-${Date.now()}`,
            request: userText,
            summary: 'Direct execution',
            steps: [{
                id: 'step-1',
                number: 1,
                description: 'Execute request',
                status: 'pending',
                dependsOn: [],
                expectedTools: [],
            }],
            status: 'in_progress',
            createdAt: new Date(),
        };
    }

    /**
     * Inject plan context as a system message.
     * If the request already has a leading system message (e.g., a mode system prompt),
     * merge the plan context into it to avoid sending multiple system messages to providers
     * that don't support or handle them inconsistently.
     */
    private injectPlanContext(
        messages: import('../types/index.js').Message[],
        planContext: string,
    ): import('../types/index.js').Message[] {
        const firstIsSystem = messages[0]?.role === 'system';
        if (firstIsSystem) {
            const existing = messages[0]!;
            const existingContent = typeof existing.content === 'string'
                ? existing.content
                : (existing.content as Array<{ text?: string }>).map(p => p.text ?? '').join('');
            return [
                { ...existing, content: `${planContext}\n\n---\n\n${existingContent}` },
                ...messages.slice(1),
            ];
        }
        return [{ role: 'system', content: planContext }, ...messages];
    }

    // ========================================================================
    // Streaming Execution
    // ========================================================================

    /**
     * Execute a request using the configured workflow, yielding chunks as they come.
     * This is the streaming equivalent of execute().
     */
    async *stream(request: CompletionRequest, providerName?: string): AsyncGenerator<import('../types/index.js').CompletionChunk> {
        // Complexity routing fires first — mirrors execute() so simple queries bypass planning
        // regardless of the planning config (same semantics in both sync and streaming paths).
        if (this.shouldRouteSimpleQuery(request)) {
            logDebug('[Workflow] stream() complexity-routed → direct');
            yield* this.streamDirect(request, providerName);
            return;
        }

        const planningEnabled = this.config.planning?.enabled;

        logDebug(`[Workflow] stream() planningEnabled=${planningEnabled} provider=${providerName ?? 'default'}`);

        // No planning — direct streaming
        if (!planningEnabled) {
            logDebug('[Workflow] stream() mode=direct');
            yield* this.streamDirect(request, providerName);
            return;
        }

        // Planning enabled — create plan, then stream execution
        yield {
            delta: '',
            workflowStep: { number: 0, description: 'Creating plan...' },
        };

        const plan = await this.planner.createPlan(request, providerName);
        this.emit('workflow:plan_created', plan);

        // If approval required, pause and wait
        if (this.config.planning?.requireApproval) {
            this.emitProgress(plan, 'awaiting_approval', 'Waiting for plan approval');

            yield {
                delta: `\n\n**Plan Created:**\n${plan.summary}\n\nSteps:\n${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}\n\n*Waiting for approval...*`,
                workflowStep: { number: 0, description: 'Awaiting approval' },
            };

            const approved = await this.waitForApproval(plan.id);
            this.emit('workflow:plan_decision', plan, approved);

            if (!approved) {
                plan.status = 'cancelled';
                yield {
                    delta: '\n\n*Plan rejected by user.*',
                    finish_reason: 'stop',
                };
                return;
            }
        }

        plan.status = 'approved';
        yield* this.streamPlanDirect(plan, request, providerName);
    }

    /**
     * Direct streaming — proxy to AIClient.stream()
     */
    private async *streamDirect(request: CompletionRequest, providerName?: string): AsyncGenerator<import('../types/index.js').CompletionChunk> {
        yield* this.client.stream(request, providerName);
    }

    /**
     * Stream plan execution as a single request (plan-direct).
     * Injects the plan as a system prefix so the LLM uses it as its own roadmap.
     */
    private async *streamPlanDirect(plan: Plan, baseRequest: CompletionRequest, providerName?: string): AsyncGenerator<import('../types/index.js').CompletionChunk> {
        plan.status = 'in_progress';
        plan.startedAt = new Date();
        this.emit('workflow:started', plan);

        const planContext = `
You have created the following plan to fulfill the request:
Summary: ${plan.summary}

Steps:
${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}

Execute this plan now.
        `.trim();

        const request: CompletionRequest = {
            ...baseRequest,
            messages: this.injectPlanContext(baseRequest.messages, planContext),
        };

        let fullContent = '';
        for await (const chunk of this.client.stream(request, providerName)) {
            if (chunk.delta) {
                fullContent += chunk.delta;
            }
            yield chunk;
        }

        plan.steps.forEach(s => {
            s.status = 'completed';
            s.result = { success: true, output: fullContent };
        });

        plan.status = 'completed';
        plan.completedAt = new Date();
        this.emit('workflow:completed', plan, {
            success: true,
            plan,
            output: fullContent,
            metrics: this.computeMetrics(plan, plan.startedAt!.getTime(), 0),
        });
        this.emitProgress(plan, 'completed', 'Done');
    }

    // ========================================================================
    // Approval Flow
    // ========================================================================

    /**
     * Wait for user approval of a plan.
     */
    private waitForApproval(planId: string): Promise<boolean> {
        return new Promise((resolve) => {
            this.pendingApprovals.set(planId, resolve);
        });
    }

    /**
     * Approve a pending plan.
     */
    approvePlan(planId: string): void {
        const resolve = this.pendingApprovals.get(planId);
        if (resolve) {
            resolve(true);
            this.pendingApprovals.delete(planId);
        }
    }

    /**
     * Reject a pending plan.
     */
    rejectPlan(planId: string): void {
        const resolve = this.pendingApprovals.get(planId);
        if (resolve) {
            resolve(false);
            this.pendingApprovals.delete(planId);
        }
    }
}
