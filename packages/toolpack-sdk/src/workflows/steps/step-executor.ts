import { AIClient } from '../../client/index.js';
import { CompletionRequest, Message, Role } from '../../types/index.js';
import { Plan, PlanStep } from '../planning/plan-types.js';
import { WorkflowConfig } from '../workflow-types.js';
import { StepTracker } from './step-tracker.js';
import { AGENT_STEP_PROMPT } from '../presets.js';
import { logDebug, logInfo, logWarn } from '../../providers/provider-logger.js';

const STEP_EXECUTION_PROMPT = AGENT_STEP_PROMPT;

const DYNAMIC_STEPS_PROMPT = `
Based on the result of the previous step, do we need to add any new steps to our plan before continuing?
Only add steps if they are absolutely necessary to complete the user's request.

Already planned next steps:
{{REMAINING_STEPS}}

Only suggest steps if they are NOT covered by the above.

If additional steps are truly required, respond with a JSON object containing the new steps.
If not necessary or if the plan is sufficient, respond with {"steps": []}.

JSON Schema:
{
  "steps": [
    { "description": "What to do", "expectedTools": [] }
  ]
}
`;

export class StepExecutor {
    private client: AIClient;
    private config?: WorkflowConfig['steps'];

    constructor(client: AIClient, config?: WorkflowConfig['steps']) {
        this.client = client;
        this.config = config;
    }

    /**
     * Executes a single step of the plan using the full tool loop.
     */
    async executeStep(
        step: PlanStep,
        plan: Plan,
        baseRequest: CompletionRequest,
        providerName?: string
    ): Promise<NonNullable<PlanStep['result']>> {
        const startTime = Date.now();
        logDebug(`[StepExecutor] executeStep() step=${step.number} "${step.description}" expectedTools=${step.expectedTools?.join(',') || 'none'}`);

        const stepRequest = this.buildStepRequest(step, plan, baseRequest);

        try {
            // Execute via AIClient (this runs the full semantic tool loop)
            const response = await this.client.generate(stepRequest, providerName);

            // Extract tools used from the raw raw response if available
            // In a real implementation we might need to track tool usage via events, 
            // but for now we look at the final response or assume it worked.
            const uniqueTools = new Set<string>();
            if (response.tool_calls) {
                response.tool_calls.forEach(tc => uniqueTools.add(tc.name));
            }

            const duration = Date.now() - startTime;
            logInfo(`[StepExecutor] Step ${step.number} completed in ${duration}ms toolsUsed=[${Array.from(uniqueTools).join(', ') || 'none'}] output_len=${response.content?.length ?? 0}`);

            return {
                success: true,
                output: response.content || 'Step completed successfully.',
                toolsUsed: Array.from(uniqueTools),
                duration,
                response,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            logWarn(`[StepExecutor] Step ${step.number} failed in ${duration}ms: ${(error as Error).message}`);
            return {
                success: false,
                error: (error as Error).message || 'Unknown execution error',
                duration,
            };
        }
    }

    /**
     * Stream a single step execution, yielding chunks as they come.
     */
    async *streamStep(
        step: PlanStep,
        plan: Plan,
        baseRequest: CompletionRequest,
        providerName?: string
    ): AsyncGenerator<import('../../types/index.js').CompletionChunk> {
        logDebug(`[StepExecutor] streamStep() step=${step.number} "${step.description}"`);
        const stepRequest = this.buildStepRequest(step, plan, baseRequest);

        // Stream via AIClient
        yield* this.client.stream(stepRequest, providerName);
    }

    /**
     * Build a context-aware request for a specific step, including previous step results
     * as conversation history so the AI knows what work was already done.
     */
    private buildStepRequest(step: PlanStep, plan: Plan, baseRequest: CompletionRequest): CompletionRequest {
        const previousResults = StepTracker.summarizeCompletedSteps(plan, step.id);

        // Use custom stepPrompt if configured, otherwise use default
        const promptTemplate = this.config?.stepPrompt || STEP_EXECUTION_PROMPT;

        const systemPrompt = promptTemplate
            .replace('{stepNumber}', step.number.toString())
            .replace('{planSummary}', plan.summary)
            .replace('{stepDescription}', step.description)
            .replace('{previousStepsResults}', previousResults);

        // Include full conversation history so the step executor understands the context
        // of the current user request (like past interactions and facts).
        const systemMessages = baseRequest.messages.filter(m => m.role === 'system');
        const historyMessages = baseRequest.messages.filter(m => m.role !== 'system');
        const userMessages = [...systemMessages, ...historyMessages];

        // Build conversation with previous step results as assistant/user pairs
        // This gives the AI actual conversation context showing work was already done
        const conversationHistory: Message[] = [];

        for (const prevStep of plan.steps) {
            if (prevStep.id === step.id) break;
            if (prevStep.status === 'completed' && prevStep.result?.output) {
                // Truncate to keep context manageable
                let output = prevStep.result.output;
                if (output.length > 2000) {
                    output = output.substring(0, 2000) + '\n... [truncated]';
                }
                conversationHistory.push({
                    role: 'assistant' as Role,
                    content: output,
                });
                conversationHistory.push({
                    role: 'user' as Role,
                    content: `Step ${prevStep.number} is complete. Now proceed with the next step.`,
                });
            }
        }

        return {
            ...baseRequest,
            messages: [
                { role: 'system', content: systemPrompt },
                ...userMessages,
                ...conversationHistory,
            ],
            tool_choice: 'auto',
        };
    }

    /**
     * Optional: Check if the AI wants to add steps dynamically based on what just happened.
     */
    async checkForDynamicSteps(
        step: PlanStep,
        plan: Plan,
        baseRequest: CompletionRequest,
        providerName?: string
    ): Promise<PlanStep[]> {
        if (!this.config?.allowDynamicSteps) {
            return [];
        }

        const currentTotal = plan.steps.length;
        const max = this.config.maxTotalSteps ?? 50;
        if (currentTotal >= max) {
            logDebug(`[StepExecutor] checkForDynamicSteps() skipped — already at maxTotalSteps=${max}`);
            return []; // Reached limit
        }

        logDebug(`[StepExecutor] checkForDynamicSteps() after step=${step.number} currentTotal=${currentTotal} max=${max}`);

        // Get remaining steps for context
        const remainingSteps = plan.steps
            .filter(s => s.status === 'pending' && s.number > step.number)
            .map(s => `${s.number}. ${s.description}`)
            .join('\n') || 'None';
        
        const prompt = DYNAMIC_STEPS_PROMPT.replace('{{REMAINING_STEPS}}', remainingSteps);
        // Use full conversation history for dynamic step check
        const checkSystemMessages = baseRequest.messages.filter(m => m.role === 'system');
        const checkHistoryMessages = baseRequest.messages.filter(m => m.role !== 'system');
        const checkUserMessages = [...checkSystemMessages, ...checkHistoryMessages];

        const checkRequest: CompletionRequest = {
            ...baseRequest,
            tool_choice: 'none', // Force text/JSON only
            response_format: 'json_object',
            messages: [
                ...checkUserMessages,
                { role: 'assistant' as Role, content: step.result?.output || '' },
                { role: 'user' as Role, content: prompt }
            ]
        };

        try {
            const response = await this.client.generate(checkRequest, providerName);
            const parsed = JSON.parse(response.content || '{"steps": []}');

            if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
                // Ensure we don't exceed maxTotalSteps
                const allowedNew = max - currentTotal;
                const toAdd = parsed.steps.slice(0, allowedNew);

                // Filter out duplicate/similar steps to prevent infinite loops
                const existingDescriptions = new Set(
                    plan.steps.map(s => this.normalizeStepDescription(s.description))
                );

                const filteredSteps = toAdd.filter((s: any) => {
                    const normalized = this.normalizeStepDescription(s.description || '');
                    if (existingDescriptions.has(normalized)) {
                        return false; // Skip duplicate
                    }
                    existingDescriptions.add(normalized);
                    return true;
                });

                if (filteredSteps.length === 0) {
                    logDebug('[StepExecutor] checkForDynamicSteps() all proposed steps were duplicates — skipping');
                    return []; // All proposed steps are duplicates
                }

                logInfo(`[StepExecutor] checkForDynamicSteps() adding ${filteredSteps.length} dynamic step(s) after step ${step.number}`);

                return filteredSteps.map((s: any, idx: number) => ({
                    id: `step-${Date.now()}-dyn-${idx}`,
                    number: 0, // Will be re-numbered by executor
                    description: s.description || 'Dynamic step',
                    expectedTools: s.expectedTools || [],
                    dependsOn: [step.id], // Depends on the step that spawned it
                    status: 'pending'
                }));
            }
        } catch (error) {
            // Silently fail dynamic check, it's just an optimization
        }

        return [];
    }

    /**
     * Normalize step description for duplicate detection.
     * Strips common variations to catch semantically similar steps.
     */
    private normalizeStepDescription(desc: string): string {
        return desc
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ')         // Normalize whitespace
            .trim()
            .split(' ')
            .filter(w => w.length > 2)    // Remove short words
            .sort()                        // Sort words for order-independent matching
            .join(' ');
    }
}
