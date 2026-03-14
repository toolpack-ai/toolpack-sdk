import { AIClient } from '../../client/index.js';
import { CompletionRequest } from '../../types/index.js';
import { Plan, PlanStep } from './plan-types.js';
import { WorkflowConfig } from '../workflow-types.js';

const DEFAULT_PLANNING_PROMPT = `
You are a planning assistant. Given a user request, create a detailed step-by-step plan.

Rules:
1. Break the task into clear, actionable steps
2. Each step should be independently executable WITHOUT requiring additional user input
3. Order steps by dependencies (what must happen first)
4. Be specific about what each step will accomplish
5. Estimate which tools will be needed for each step
6. If the user's request is ambiguous, make reasonable assumptions and proceed - do NOT create steps that ask for clarification
7. Steps should produce concrete outputs, not ask questions or wait for user input
8. ALWAYS include at least one step, even for simple questions. For simple factual questions, create a single step like "Provide the answer to [question]"
9. The exact result MUST be valid JSON matching this schema:
{
  "summary": "Brief description of the overall goal",
  "steps": [
    {
      "number": 1,
      "description": "What this step does",
      "expectedTools": ["tool.name"],
      "dependsOn": []
    }
  ]
}
`;

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
            return this.parsePlan(response.content || '', request, response);
        } catch (error) {
            return this.createFallbackPlan(request);
        }
    }

    /**
     * Create a lightweight implicit plan when steps are enabled but planning phase is skipped.
     */
    async createImplicitPlan(request: CompletionRequest, providerName?: string): Promise<Plan> {
        // Fallback or simplified logic can go here. For now, we reuse the robust createPlan logic
        // but it could be optimized in the future.
        return this.createPlan(request, providerName);
    }

    private parsePlan(jsonString: string, originalRequest: CompletionRequest, planningResponse?: import('../../types/index.js').CompletionResponse): Plan {
        try {
            const parsed = JSON.parse(jsonString);

            if (!parsed.summary || !Array.isArray(parsed.steps)) {
                throw new Error('Invalid plan structure: missing summary or steps array');
            }

            const maxSteps = this.config?.maxSteps ?? 20;
            const limitedSteps = parsed.steps.slice(0, maxSteps);

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
            return this.createFallbackPlan(originalRequest);
        }
    }

    private createFallbackPlan(request: CompletionRequest): Plan {
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
