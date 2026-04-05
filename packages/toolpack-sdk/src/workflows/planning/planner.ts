import { AIClient } from '../../client/index.js';
import { CompletionRequest } from '../../types/index.js';
import { Plan, PlanStep } from './plan-types.js';
import { WorkflowConfig } from '../workflow-types.js';
import { AGENT_PLANNING_PROMPT } from '../presets.js';
import { logDebug, logInfo, logWarn } from '../../providers/provider-logger.js';

const DEFAULT_PLANNING_PROMPT = AGENT_PLANNING_PROMPT;

export class Planner {
    private client: AIClient;
    private config?: WorkflowConfig['planning'];

    constructor(client: AIClient, config?: WorkflowConfig['planning']) {
        this.client = client;
        this.config = config;
    }

    /**
     * Create a detailed step-by-step plan from the user's request.
     */
    async createPlan(request: CompletionRequest, providerName?: string): Promise<Plan> {
        const systemPrompt = this.config?.planningPrompt || DEFAULT_PLANNING_PROMPT;
        const userText = request.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '[obj]').join(' ').substring(0, 100);
        logDebug(`[Planner] createPlan() provider=${providerName ?? 'default'} maxSteps=${this.config?.maxSteps ?? 20} request="${userText}..."`);

        // We use the AIClient to generate the plan, but WITHOUT tools available
        // to force a JSON response instead of arbitrary tool calls.
        // Include full conversation history so the planner understands context (like previous names).
        const systemMessages = request.messages.filter(m => m.role === 'system');
        const historyMessages = request.messages.filter(m => m.role !== 'system');
        const planningMessages = [
            { role: 'system' as const, content: systemPrompt },
            ...systemMessages,
            ...historyMessages,
        ];

        const planningRequest: CompletionRequest = {
            ...request,
            tools: undefined,
            tool_choice: 'none',
            response_format: 'json_object',
            messages: planningMessages,
        };

        try {
            const response = await this.client.generate(planningRequest, providerName);
            const plan = this.parsePlan(response.content || '', request, response);
            logInfo(`[Planner] createPlan() succeeded plan.id=${plan.id} steps=${plan.steps.length}`);
            return plan;
        } catch (error) {
            logWarn(`[Planner] createPlan() failed, using fallback: ${(error as Error).message}`);
            return this.createFallbackPlan(request);
        }
    }

    private parsePlan(jsonString: string, originalRequest: CompletionRequest, planningResponse?: import('../../types/index.js').CompletionResponse): Plan {
        try {
            const parsed = JSON.parse(jsonString);

            if (!parsed.summary || !Array.isArray(parsed.steps)) {
                throw new Error('Invalid plan structure: missing summary or steps array');
            }

            const maxSteps = this.config?.maxSteps ?? 20;
            const limitedSteps = parsed.steps.slice(0, maxSteps);
            if (parsed.steps.length > maxSteps) {
                logWarn(`[Planner] parsePlan() truncated ${parsed.steps.length} steps to maxSteps=${maxSteps}`);
            }
            logDebug(`[Planner] parsePlan() parsed ${limitedSteps.length} steps successfully`);

            const steps: PlanStep[] = limitedSteps.map((s: any, i: number) => ({
                id: `step-${Date.now()}-${i}`,
                number: s.number || i + 1,
                description: s.description || 'Unknown step',
                expectedTools: s.expectedTools || [],
                dependsOn: s.dependsOn || [],
                status: 'pending',
            }));

            // Extract the original prompt as a summary of the request
            const userText = originalRequest.messages
                .filter(m => m.role === 'user')
                .map(m => typeof m.content === 'string' ? m.content : '[Complex Object]')
                .join('\\n');

            return {
                id: `plan-${Date.now()}`,
                request: userText,
                summary: parsed.summary,
                steps,
                status: 'draft',
                createdAt: new Date(),
                planningResponse,
            };
        } catch (error) {
            logWarn(`[Planner] parsePlan() failed: ${(error as Error).message} — using fallback`);
            return this.createFallbackPlan(originalRequest);
        }
    }

    private createFallbackPlan(request: CompletionRequest): Plan {
        logWarn('[Planner] createFallbackPlan() — creating single-step fallback due to plan generation failure');
        const userText = request.messages
            .filter(m => m.role === 'user')
            .map(m => typeof m.content === 'string' ? m.content : '[Complex Object]')
            .join('\\n');

        return {
            id: `plan-${Date.now()}-fallback`,
            request: userText,
            summary: 'Fallback single-step plan due to generation failure',
            steps: [{
                id: 'step-1',
                number: 1,
                description: 'Execute the user request',
                status: 'pending',
                expectedTools: [],
                dependsOn: [],
            }],
            status: 'draft',
            createdAt: new Date(),
        };
    }
}
