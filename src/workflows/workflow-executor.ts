import { EventEmitter } from 'events';
import { AIClient } from '../client/index.js';
import { CompletionRequest } from '../types/index.js';
import { WorkflowConfig, WorkflowResult, WorkflowProgress } from './workflow-types.js';
import { Plan } from './planning/plan-types.js';
import { Planner } from './planning/planner.js';
import { StepExecutor } from './steps/step-executor.js';
import { StepTracker } from './steps/step-tracker.js';

export class WorkflowExecutor extends EventEmitter {
    private client: AIClient;
    private config: WorkflowConfig;
    private planner: Planner;
    private stepExecutor: StepExecutor;

    // For approval flow
    private pendingApprovals = new Map<string, (approved: boolean) => void>();

    constructor(client: AIClient, config: WorkflowConfig) {
        super();
        this.client = client;
        this.config = config;
        this.planner = new Planner(client, config.planning);
        this.stepExecutor = new StepExecutor(client, config.steps);
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
        this.stepExecutor = new StepExecutor(this.client, config.steps);
    }

    /**
     * Execute a request using the configured workflow.
     */
    async execute(request: CompletionRequest, providerName?: string): Promise<WorkflowResult> {
        const planningEnabled = this.config.planning?.enabled;
        const stepsEnabled = this.config.steps?.enabled;

        // Case 1: No workflow — direct execution
        if (!planningEnabled && !stepsEnabled) {
            return this.executeDirect(request, providerName);
        }

        // Case 2: Planning enabled
        let plan: Plan | null = null;
        if (planningEnabled) {
            plan = await this.createPlan(request, providerName);
            this.emit('workflow:plan_created', plan);

            // If approval required, pause and wait
            if (this.config.planning?.requireApproval) {
                this.emitProgress(plan, 'awaiting_approval', 'Waiting for plan approval');
                const approved = await this.waitForApproval(plan.id);
                this.emit('workflow:plan_decision', plan, approved);

                if (!approved) {
                    plan.status = 'cancelled';
                    this.emitProgress(plan, 'failed', 'Plan rejected by user');
                    return {
                        success: false,
                        plan,
                        error: 'Plan rejected by user',
                        metrics: { totalDuration: 0, stepsCompleted: 0, stepsFailed: 0, retriesUsed: 0 },
                    };
                }
            }

            plan.status = 'approved';
        }

        // Case 3: Step-based execution
        if (stepsEnabled) {
            // If no plan, create implicit steps from the request
            if (!plan) {
                plan = await this.planner.createImplicitPlan(request, providerName);
                this.emit('workflow:plan_created', plan);
                plan.status = 'approved';
            }

            return this.executeStepByStep(plan, request, providerName);
        }

        // Case 4: Planning without steps — execute plan as single request
        if (plan) {
            return this.executePlanDirect(plan, request, providerName);
        }

        // Fallback (should not be reached based on logic above)
        return this.executeDirect(request, providerName);
    }

    /**
     * Direct execution — current SDK behavior, wrapped in WorkflowResult.
     */
    private async executeDirect(request: CompletionRequest, providerName?: string): Promise<WorkflowResult> {
        const startTime = Date.now();
        const plan = this.createDummyPlan(request);

        try {
            this.emitProgress(plan, 'executing', 'Direct execution');
            const response = await this.client.generate(request, providerName);

            // Update plan inline for accurate returned result
            plan.status = 'completed';
            plan.completedAt = new Date();
            plan.steps[0]!.status = 'completed';

            const result: WorkflowResult = {
                success: true,
                plan,
                output: response.content || undefined,
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
        // Emit a dummy plan for initial planning progress state
        const draft = this.createDummyPlan(request);
        draft.status = 'draft';
        this.emitProgress(draft, 'planning', 'Creating plan...');

        return this.planner.createPlan(request, providerName);
    }

    /**
     * Execute plan step by step using the StepExecutor.
     */
    private async executeStepByStep(plan: Plan, request: CompletionRequest, providerName?: string): Promise<WorkflowResult> {
        plan.status = 'in_progress';
        plan.startedAt = new Date();
        this.emit('workflow:started', plan);

        const startTime = Date.now();
        let retriesUsed = 0;

        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];

            // Skip non-pending steps 
            if (step.status !== 'pending' && step.status !== 'failed') {
                continue;
            }

            // Check dependencies — match by step ID or step number
            if (step.dependsOn?.length) {
                const unmetDeps = step.dependsOn.filter(depId => {
                    // AI may produce numeric step numbers OR string IDs
                    const dep = plan.steps.find(s =>
                        s.id === String(depId) || s.number === Number(depId)
                    );
                    // If we can't find the dependency at all, treat it as met
                    // (avoids false-skipping when AI generates unknown refs)
                    if (!dep) return false;
                    return dep.status !== 'completed';
                });

                if (unmetDeps.length > 0) {
                    step.status = 'skipped';
                    step.result = { success: false, error: `Unmet dependencies: ${unmetDeps.join(', ')}` };
                    continue;
                }
            }

            // Execute step with retries
            step.status = 'in_progress';
            this.emit('workflow:step_start', step, plan);
            this.emitProgress(plan, 'executing', step.description);

            let attempt = 0;
            const maxRetries = this.config.steps?.maxRetries ?? 3;
            let lastError: Error | null = null;
            let success = false;

            while (attempt <= maxRetries) {
                try {
                    const result = await this.stepExecutor.executeStep(step, plan, request, providerName);

                    if (result.success) {
                        step.status = 'completed';
                        step.result = result;
                        this.emit('workflow:step_complete', step, plan);
                        success = true;
                        break;
                    } else {
                        // Throw to trigger retry logic
                        throw new Error(result.error || 'Step returned unsuccessful result');
                    }
                } catch (error) {
                    lastError = error as Error;
                    attempt++;

                    if (attempt <= maxRetries && this.config.steps?.retryOnFailure) {
                        retriesUsed++;
                        this.emit('workflow:step_retry', step, attempt, plan);
                        this.emitProgress(plan, 'executing', `[Retry ${attempt}] ${step.description}`);
                    } else {
                        step.status = 'failed';
                        step.result = { success: false, error: lastError.message };
                        this.emit('workflow:step_failed', step, lastError, plan);
                        break;
                    }
                }
            }

            // Handle failure strategy if step failed completely
            if (!success) {
                const strategy = this.config.onFailure?.strategy || 'abort';

                if (strategy === 'abort') {
                    plan.status = 'failed';
                    plan.completedAt = new Date();


                    const res = {
                        success: false,
                        plan,
                        error: `Step ${step.number} failed: ${lastError?.message}`,
                        metrics: this.computeMetrics(plan, startTime, retriesUsed) as any,
                    };
                    this.emit('workflow:failed', plan, lastError!);
                    this.emitProgress(plan, 'failed', 'Workflow aborted due to step failure');
                    return res;
                }
                else if (strategy === 'ask_user') {
                    // Similar to requireApproval, pause execution
                    this.emitProgress(plan, 'awaiting_approval', `Step failed: ${lastError?.message}. Continue?`);
                    const approved = await this.waitForApproval(plan.id);

                    if (!approved) {
                        plan.status = 'failed';
                        plan.completedAt = new Date();
                        const res = {
                            success: false,
                            plan,
                            error: `Workflow aborted by user after step ${step.number} failure`,
                            metrics: this.computeMetrics(plan, startTime, retriesUsed) as any,
                        };
                        this.emit('workflow:failed', plan, new Error(res.error));
                        return res;
                    }
                    // User approved continuing, treat like 'skip'
                    step.status = 'skipped';
                }
                else {
                    // 'skip' or 'try_alternative' (not fully implemented yet, treating as skip)
                    step.status = 'skipped';
                }
            }

            // Check if AI wants to add dynamic steps
            if (success && this.config.steps?.allowDynamicSteps) {
                const newSteps = await this.stepExecutor.checkForDynamicSteps(step, plan, request, providerName);
                if (newSteps.length > 0) {
                    // Update numbering
                    let currentNum = step.number + 1;
                    for (const ns of newSteps) {
                        ns.number = currentNum++;
                    }
                    // Shift later steps
                    for (let j = i + 1; j < plan.steps.length; j++) {
                        plan.steps[j].number = currentNum++;
                    }

                    // Insert after current step
                    plan.steps.splice(i + 1, 0, ...newSteps);
                    newSteps.forEach(s => this.emit('workflow:step_added', s, plan));
                }
            }
        }

        // All steps completed or skipped
        plan.status = 'completed';
        plan.completedAt = new Date();
        plan.metrics = this.computeMetrics(plan, startTime, retriesUsed);

        const result: WorkflowResult = {
            success: true,
            plan,
            output: this.extractFinalOutput(plan),
            response: this.extractFinalResponse(plan),
            metrics: plan.metrics as any,
        };

        this.emit('workflow:completed', plan, result);
        this.emitProgress(plan, 'completed', 'Done');

        return result;
    }

    /**
     * Planning without steps — execute plan as single generate call.
     */
    private async executePlanDirect(plan: Plan, baseRequest: CompletionRequest, providerName?: string): Promise<WorkflowResult> {
        const startTime = Date.now();
        plan.status = 'in_progress';
        plan.startedAt = new Date();
        this.emit('workflow:started', plan);
        this.emitProgress(plan, 'executing', 'Executing plan');

        // Inject the plan into the system prompt for execution
        const planContext = `
You have created the following plan to fulfill the request:
Summary: ${plan.summary}

Steps:
${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}

Execute this plan now.
        `.trim();

        const request: CompletionRequest = {
            ...baseRequest,
            messages: [
                { role: 'system', content: planContext },
                ...baseRequest.messages,
            ]
        };

        try {
            const response = await this.client.generate(request, providerName);

            // Mark all steps completed since it was evaluated in one go
            plan.steps.forEach(s => {
                s.status = 'completed';
                s.result = { success: true, output: response.content || '' };
            });

            plan.status = 'completed';
            plan.completedAt = new Date();
            plan.metrics = this.computeMetrics(plan, startTime, 0);

            const result: WorkflowResult = {
                success: true,
                plan,
                output: response.content || undefined,
                metrics: plan.metrics as any,
            };

            this.emit('workflow:completed', plan, result);
            this.emitProgress(plan, 'completed', 'Done');
            return result;

        } catch (error) {
            plan.status = 'failed';
            plan.completedAt = new Date();

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
     * Emit a progress event using StepTracker.
     */
    private emitProgress(plan: Plan, statusStr?: WorkflowProgress['status'], overrideDesc?: string): void {
        if (!this.config.progress?.enabled) {
            return;
        }

        const progress = StepTracker.getProgress(plan);
        if (statusStr) progress.status = statusStr;
        if (overrideDesc) progress.currentStepDescription = overrideDesc;

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
     * Summarize the entire plan execution.
     */
    private summarizePlanResult(plan: Plan): string {
        return `Workflow completed. \nSummary: ${plan.summary}\nSteps:\n` +
            plan.steps.map(s => `[${s.status.toUpperCase()}] ${s.description}`).join('\n');
    }

    /**
     * Extract the final output from the last completed step.
     * Returns the actual AI response instead of a workflow summary.
     */
    private extractFinalOutput(plan: Plan): string | undefined {
        // Find the last completed step with output
        for (let i = plan.steps.length - 1; i >= 0; i--) {
            const step = plan.steps[i];
            if (step.status === 'completed' && step.result?.output) {
                return step.result.output;
            }
        }
        // If no steps were executed, return the plan summary directly
        // (not the verbose "Workflow completed..." format)
        if (plan.steps.length === 0 || plan.steps.every(s => s.status === 'pending')) {
            return plan.summary;
        }
        // Fallback to summary if no step output found
        return this.summarizePlanResult(plan);
    }

    /**
     * Extract the full response metadata from the last completed step.
     */
    private extractFinalResponse(plan: Plan): import('../types/index.js').CompletionResponse | undefined {
        // Find the last completed step with response metadata
        for (let i = plan.steps.length - 1; i >= 0; i--) {
            const step = plan.steps[i];
            if (step.status === 'completed' && step.result?.response) {
                return step.result.response;
            }
        }
        return undefined;
    }

    /**
     * Create a dummy plan for internal representation when no plan is generated.
     */
    private createDummyPlan(request: CompletionRequest): Plan {
        const userText = request.messages
            .filter(m => m.role === 'user')
            .map(m => typeof m.content === 'string' ? m.content : '[Object]')
            .join('\\n');

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

    // ========================================================================
    // Streaming Execution
    // ========================================================================

    /**
     * Execute a request using the configured workflow, yielding chunks as they come.
     * This is the streaming equivalent of execute().
     */
    async *stream(request: CompletionRequest, providerName?: string): AsyncGenerator<import('../types/index.js').CompletionChunk> {
        const planningEnabled = this.config.planning?.enabled;
        const stepsEnabled = this.config.steps?.enabled;

        // Case 1: No workflow — direct streaming
        if (!planningEnabled && !stepsEnabled) {
            yield* this.streamDirect(request, providerName);
            return;
        }

        // Case 2: Planning enabled
        let plan: Plan | null = null;
        if (planningEnabled) {
            // Yield a progress chunk for planning phase
            yield {
                delta: '',
                workflowStep: { number: 0, description: 'Creating plan...' },
            };

            plan = await this.planner.createPlan(request, providerName);
            this.emit('workflow:plan_created', plan);

            // If approval required, we need to pause - emit event and wait
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
        }

        // Case 3: Step-based execution with streaming
        if (stepsEnabled) {
            if (!plan) {
                plan = await this.planner.createImplicitPlan(request, providerName);
                this.emit('workflow:plan_created', plan);
                plan.status = 'approved';
            }

            yield* this.streamStepByStep(plan, request, providerName);
            return;
        }

        // Case 4: Planning without steps — stream the plan execution
        if (plan) {
            yield* this.streamPlanDirect(plan, request, providerName);
            return;
        }

        // Fallback
        yield* this.streamDirect(request, providerName);
    }

    /**
     * Direct streaming — proxy to AIClient.stream()
     */
    private async *streamDirect(request: CompletionRequest, providerName?: string): AsyncGenerator<import('../types/index.js').CompletionChunk> {
        yield* this.client.stream(request, providerName);
    }

    /**
     * Stream plan execution step by step.
     */
    private async *streamStepByStep(plan: Plan, request: CompletionRequest, providerName?: string): AsyncGenerator<import('../types/index.js').CompletionChunk> {
        plan.status = 'in_progress';
        plan.startedAt = new Date();
        this.emit('workflow:started', plan);

        const startTime = Date.now();
        let retriesUsed = 0;

        for (let i = 0; i < plan.steps.length; i++) {
            // Check for abort signal at start of each step
            if (request.signal?.aborted) {
                plan.status = 'cancelled';
                plan.completedAt = new Date();
                this.emit('workflow:failed', plan, new Error('Interrupted by user'));
                return;
            }

            const step = plan.steps[i];
            if (step.status !== 'pending' && step.status !== 'failed') {
                continue;
            }

            // Check dependencies — match by step ID or step number
            if (step.dependsOn?.length) {
                const unmetDeps = step.dependsOn.filter(depId => {
                    const dep = plan.steps.find(s =>
                        s.id === String(depId) || s.number === Number(depId)
                    );
                    if (!dep) return false;
                    return dep.status !== 'completed';
                });

                if (unmetDeps.length > 0) {
                    step.status = 'skipped';
                    step.result = { success: false, error: `Unmet dependencies: ${unmetDeps.join(', ')}` };
                    continue;
                }
            }

            // Emit step start
            step.status = 'in_progress';
            this.emit('workflow:step_start', step, plan);
            this.emitProgress(plan, 'executing', step.description);

            // Step header is communicated via workflow:step_start event + workflow:progress event
            // (no delta content needed — CLI displays it in the status bar via event listener)

            let attempt = 0;
            const maxRetries = this.config.steps?.maxRetries ?? 3;
            let lastError: Error | null = null;
            let success = false;
            let stepOutput = '';

            while (attempt <= maxRetries) {
                try {
                    // Stream the step execution
                    for await (const chunk of this.stepExecutor.streamStep(step, plan, request, providerName)) {
                        // Check for abort signal during step streaming
                        if (request.signal?.aborted) {
                            step.status = 'skipped';
                            plan.status = 'cancelled';
                            plan.completedAt = new Date();
                            this.emit('workflow:failed', plan, new Error('Interrupted by user'));
                            return;
                        }

                        if (chunk.delta) {
                            stepOutput += chunk.delta;
                        }
                        yield {
                            ...chunk,
                            workflowStep: { number: step.number, description: step.description },
                        };
                    }

                    step.status = 'completed';
                    step.result = { success: true, output: stepOutput, duration: Date.now() - startTime };
                    this.emit('workflow:step_complete', step, plan);

                    // Emit progress update after step completion
                    this.emitProgress(plan, 'executing');

                    success = true;
                    break;
                } catch (error) {
                    lastError = error as Error;
                    attempt++;

                    if (attempt <= maxRetries && this.config.steps?.retryOnFailure) {
                        retriesUsed++;
                        this.emit('workflow:step_retry', step, attempt, plan);
                        this.emitProgress(plan, 'executing', `[Retry ${attempt}/${maxRetries}] ${step.description}`);
                        // Retry info is shown in the workflow progress shimmer, not in message content
                    } else {
                        step.status = 'failed';
                        step.result = { success: false, error: lastError.message };
                        this.emit('workflow:step_failed', step, lastError, plan);
                        break;
                    }
                }
            }

            // Handle failure
            if (!success) {
                const strategy = this.config.onFailure?.strategy || 'abort';

                if (strategy === 'abort') {
                    plan.status = 'failed';
                    plan.completedAt = new Date();
                    this.emit('workflow:failed', plan, lastError!);
                    yield {
                        delta: `\n\n**Step failed:** ${lastError?.message}\n*Workflow aborted.*`,
                        finish_reason: 'stop',
                    };
                    return;
                } else if (strategy === 'skip') {
                    step.status = 'skipped';
                    yield {
                        delta: `\n*Step skipped due to failure.*\n`,
                        workflowStep: { number: step.number, description: step.description },
                    };
                }
                // For 'ask_user' we'd need async approval which is complex in streaming
            }

            // Check for dynamic steps
            if (success && this.config.steps?.allowDynamicSteps) {
                const newSteps = await this.stepExecutor.checkForDynamicSteps(step, plan, request, providerName);
                if (newSteps.length > 0) {
                    let currentNum = step.number + 1;
                    for (const ns of newSteps) {
                        ns.number = currentNum++;
                    }
                    for (let j = i + 1; j < plan.steps.length; j++) {
                        plan.steps[j].number = currentNum++;
                    }
                    plan.steps.splice(i + 1, 0, ...newSteps);
                    newSteps.forEach(s => this.emit('workflow:step_added', s, plan));
                    // Dynamic step additions are communicated via workflow:step_added events
                    this.emitProgress(plan, 'executing');
                }
            }
        }

        // Workflow completed
        plan.status = 'completed';
        plan.completedAt = new Date();
        plan.metrics = this.computeMetrics(plan, startTime, retriesUsed);

        const result: WorkflowResult = {
            success: true,
            plan,
            output: this.extractFinalOutput(plan),
            response: this.extractFinalResponse(plan),
            metrics: plan.metrics as any,
        };

        // Emit completion events and progress update
        this.emit('workflow:completed', plan, result);
        this.emitProgress(plan, 'completed', 'Done');

        // Workflow completion is communicated via workflow:completed event + workflow:progress event
        // Yield a final empty chunk with finish_reason to signal end of stream
        yield {
            delta: '',
            finish_reason: 'stop',
        };
    }

    /**
     * Stream plan execution as a single request (planning without steps).
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
            messages: [
                { role: 'system', content: planContext },
                ...baseRequest.messages,
            ]
        };

        yield {
            delta: `**Plan:**\n${plan.summary}\n\n`,
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
