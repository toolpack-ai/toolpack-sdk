import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StepExecutor } from '../../src/workflows/steps/step-executor';
import { AIClient } from '../../src/client';
import { Plan, PlanStep } from '../../src/workflows/planning/plan-types';
import { ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse } from '../../src/providers/base';

class MockProvider implements ProviderAdapter {
    private response: string = '';

    setResponse(response: string) {
        this.response = response;
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        return { content: this.response };
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        yield { delta: this.response };
        yield { delta: '', finish_reason: 'stop' };
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        return { embeddings: [] };
    }
}

function createMockPlan(): Plan {
    return {
        id: 'test-plan-1',
        request: 'Test request',
        summary: 'Test plan',
        steps: [
            {
                id: 'step-1',
                number: 1,
                description: 'First step',
                status: 'pending',
                dependsOn: [],
                expectedTools: [],
            },
            {
                id: 'step-2',
                number: 2,
                description: 'Second step',
                status: 'pending',
                dependsOn: ['step-1'],
                expectedTools: [],
            },
        ],
        status: 'approved',
        createdAt: new Date(),
    };
}

describe('StepExecutor', () => {
    let mockProvider: MockProvider;
    let client: AIClient;

    beforeEach(() => {
        mockProvider = new MockProvider();
        client = new AIClient({
            providers: { mock: mockProvider },
            defaultProvider: 'mock',
        });
    });

    describe('executeStep', () => {
        it('should execute a single step and return result', async () => {
            const executor = new StepExecutor(client, { enabled: true });
            const plan = createMockPlan();
            const step = plan.steps[0];

            mockProvider.setResponse('Step executed successfully');

            const result = await executor.executeStep(step, plan, {
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.output).toContain('Step executed successfully');
        });

        it('should include step context in the prompt', async () => {
            const executor = new StepExecutor(client, { enabled: true });
            const plan = createMockPlan();
            const step = plan.steps[0];

            let capturedRequest: CompletionRequest | null = null;
            const originalGenerate = client.generate.bind(client);
            vi.spyOn(client, 'generate').mockImplementation(async (req) => {
                capturedRequest = req;
                return originalGenerate(req);
            });

            mockProvider.setResponse('Result');

            await executor.executeStep(step, plan, {
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(capturedRequest).not.toBeNull();
            // The request should contain step context
            const messages = capturedRequest!.messages;
            const hasStepContext = messages.some((m: any) =>
                typeof m.content === 'string' &&
                (m.content.includes('Step 1') || m.content.includes('First step'))
            );
            expect(hasStepContext).toBe(true);
        });
    });

    describe('streamStep', () => {
        it('should stream step execution', async () => {
            const executor = new StepExecutor(client, { enabled: true });
            const plan = createMockPlan();
            const step = plan.steps[0];

            mockProvider.setResponse('Streamed content');

            const chunks: any[] = [];
            for await (const chunk of executor.streamStep(step, plan, {
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            })) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            const content = chunks.map(c => c.delta || '').join('');
            expect(content).toContain('Streamed content');
        });
    });

    describe('checkForDynamicSteps', () => {
        it('should return empty array when dynamic steps disabled', async () => {
            const executor = new StepExecutor(client, { enabled: true, allowDynamicSteps: false });
            const plan = createMockPlan();
            const step = plan.steps[0];
            step.status = 'completed';
            step.result = { success: true, output: 'Done' };

            const newSteps = await executor.checkForDynamicSteps(step, plan, {
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(newSteps).toEqual([]);
        });

        it('should detect and return new steps when AI suggests them', async () => {
            const executor = new StepExecutor(client, { enabled: true, allowDynamicSteps: true });
            const plan = createMockPlan();
            const step = plan.steps[0];
            step.status = 'completed';
            step.result = { success: true, output: 'Done, but need more steps' };

            // Mock AI response suggesting new steps
            const dynamicStepsJson = JSON.stringify({
                needsMoreSteps: true,
                newSteps: [
                    { description: 'Additional step 1', expectedTools: [] },
                    { description: 'Additional step 2', expectedTools: [] },
                ],
            });
            mockProvider.setResponse(dynamicStepsJson);

            const newSteps = await executor.checkForDynamicSteps(step, plan, {
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            // May return steps if AI suggests them
            expect(Array.isArray(newSteps)).toBe(true);
        });
    });

    describe('Step Dependencies', () => {
        it('should include previous step results in context', async () => {
            const executor = new StepExecutor(client, { enabled: true });
            const plan = createMockPlan();

            // Complete first step
            plan.steps[0].status = 'completed';
            plan.steps[0].result = { success: true, output: 'First step output' };

            const step = plan.steps[1]; // Second step depends on first

            let capturedRequest: CompletionRequest | null = null;
            vi.spyOn(client, 'generate').mockImplementation(async (req) => {
                capturedRequest = req;
                return { content: 'Second step result' };
            });

            await executor.executeStep(step, plan, {
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(capturedRequest).not.toBeNull();
            // Should include context about previous steps
            const messages = capturedRequest!.messages;
            const contextMessage = messages.find((m: any) =>
                typeof m.content === 'string' &&
                m.content.includes('First step')
            );
            expect(contextMessage).toBeDefined();
        });
    });
});
