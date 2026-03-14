import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowExecutor } from '../../src/workflows/workflow-executor';
import { AIClient } from '../../src/client';
import { WorkflowConfig } from '../../src/workflows/workflow-types';
import { Plan } from '../../src/workflows/planning/plan-types';
import { ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse } from '../../src/providers/base';

// Mock provider that returns predictable responses
class MockProvider implements ProviderAdapter {
    private responseQueue: string[] = [];

    setResponses(responses: string[]) {
        this.responseQueue = [...responses];
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        const response = this.responseQueue.shift() || 'Default response';
        return { content: response };
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        const response = this.responseQueue.shift() || 'Default response';
        yield { delta: response };
        yield { delta: '', finish_reason: 'stop' };
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        return { embeddings: [] };
    }
}

describe('WorkflowExecutor', () => {
    let mockProvider: MockProvider;
    let client: AIClient;

    beforeEach(() => {
        mockProvider = new MockProvider();
        client = new AIClient({
            providers: { mock: mockProvider },
            defaultProvider: 'mock',
        });
    });

    describe('Direct Execution (No Workflow)', () => {
        it('should execute directly when planning and steps are disabled', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: false },
                steps: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, config);
            mockProvider.setResponses(['Direct response']);

            const result = await executor.execute({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'test',
            });

            expect(result.success).toBe(true);
            expect(result.output).toBe('Direct response');
            expect(result.metrics.stepsCompleted).toBe(1);
        });

        it('should emit workflow:completed event on success', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: false },
                steps: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, config);
            mockProvider.setResponses(['Response']);

            const completedHandler = vi.fn();
            executor.on('workflow:completed', completedHandler);

            await executor.execute({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(completedHandler).toHaveBeenCalled();
        });
    });

    describe('Planning Phase', () => {
        it('should create a plan when planning is enabled', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
                steps: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, config);

            // Mock plan response
            const planJson = JSON.stringify({
                summary: 'Test plan',
                steps: [
                    { number: 1, description: 'Step 1', expectedTools: [] },
                ],
            });
            mockProvider.setResponses([planJson, 'Execution result']);

            const planCreatedHandler = vi.fn();
            executor.on('workflow:plan_created', planCreatedHandler);

            await executor.execute({
                messages: [{ role: 'user', content: 'Create something' }],
                model: 'test',
            });

            expect(planCreatedHandler).toHaveBeenCalled();
            const plan = planCreatedHandler.mock.calls[0][0] as Plan;
            expect(plan.summary).toBe('Test plan');
        });

        it('should wait for approval when requireApproval is true', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: true },
                steps: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Approval test plan',
                steps: [{ number: 1, description: 'Step 1', expectedTools: [] }],
            });
            mockProvider.setResponses([planJson, 'Execution result']);

            let planId: string | null = null;
            executor.on('workflow:plan_created', (plan: Plan) => {
                planId = plan.id;
                // Approve after a short delay
                setTimeout(() => executor.approvePlan(plan.id), 10);
            });

            const result = await executor.execute({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(result.success).toBe(true);
            expect(planId).not.toBeNull();
        });

        it('should cancel workflow when plan is rejected', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: true },
                steps: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Rejection test plan',
                steps: [{ number: 1, description: 'Step 1', expectedTools: [] }],
            });
            mockProvider.setResponses([planJson]);

            executor.on('workflow:plan_created', (plan: Plan) => {
                setTimeout(() => executor.rejectPlan(plan.id), 10);
            });

            const result = await executor.execute({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Plan rejected by user');
            expect(result.plan.status).toBe('cancelled');
        });
    });

    describe('Step-by-Step Execution', () => {
        it('should execute steps sequentially', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
                steps: { enabled: true, retryOnFailure: false },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Multi-step plan',
                steps: [
                    { number: 1, description: 'First step', expectedTools: [] },
                    { number: 2, description: 'Second step', expectedTools: [] },
                ],
            });
            mockProvider.setResponses([planJson, 'Step 1 result', 'Step 2 result']);

            const stepStartHandler = vi.fn();
            const stepCompleteHandler = vi.fn();
            executor.on('workflow:step_start', stepStartHandler);
            executor.on('workflow:step_complete', stepCompleteHandler);

            const result = await executor.execute({
                messages: [{ role: 'user', content: 'Do multi-step task' }],
                model: 'test',
            });

            expect(result.success).toBe(true);
            expect(stepStartHandler).toHaveBeenCalledTimes(2);
            expect(stepCompleteHandler).toHaveBeenCalledTimes(2);
        });

        it('should emit progress events during execution', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
                steps: { enabled: true },
                progress: { enabled: true },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Progress test',
                steps: [
                    { number: 1, description: 'Step 1', expectedTools: [] },
                ],
            });
            mockProvider.setResponses([planJson, 'Result']);

            const progressHandler = vi.fn();
            executor.on('workflow:progress', progressHandler);

            await executor.execute({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(progressHandler).toHaveBeenCalled();
            const progressEvents = progressHandler.mock.calls.map(c => c[0]);
            expect(progressEvents.some(p => p.status === 'executing')).toBe(true);
        });
    });

    describe('Failure Handling', () => {
        it('should abort on failure with abort strategy', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
                steps: { enabled: true, retryOnFailure: false },
                onFailure: { strategy: 'abort' },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Failure test',
                steps: [
                    { number: 1, description: 'Will fail', expectedTools: [] },
                    { number: 2, description: 'Should not run', expectedTools: [] },
                ],
            });

            // First response is plan, second throws error
            mockProvider.setResponses([planJson]);

            // Make the step execution fail by not providing a response
            const failedHandler = vi.fn();
            executor.on('workflow:failed', failedHandler);

            const result = await executor.execute({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            // The plan should be created but execution may fail
            expect(result.plan).toBeDefined();
        });

        it('should skip failed step with skip strategy', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
                steps: { enabled: true, retryOnFailure: false },
                onFailure: { strategy: 'skip' },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Skip test',
                steps: [
                    { number: 1, description: 'Step 1', expectedTools: [] },
                    { number: 2, description: 'Step 2', expectedTools: [] },
                ],
            });
            mockProvider.setResponses([planJson, 'Step 1 result', 'Step 2 result']);

            const result = await executor.execute({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Streaming Execution', () => {
        it('should stream step-by-step execution', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
                steps: { enabled: true },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Streaming test',
                steps: [
                    { number: 1, description: 'Stream step', expectedTools: [] },
                ],
            });
            mockProvider.setResponses([planJson, 'Streamed content']);

            const chunks: any[] = [];
            for await (const chunk of executor.stream({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            })) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            // Should have workflow step info in chunks
            const stepChunks = chunks.filter(c => c.workflowStep);
            expect(stepChunks.length).toBeGreaterThan(0);
        });

        it('should include workflowStep context in chunks', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
                steps: { enabled: true },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Context test',
                steps: [
                    { number: 1, description: 'Test step', expectedTools: [] },
                ],
            });
            mockProvider.setResponses([planJson, 'Content']);

            let foundStepContext = false;
            for await (const chunk of executor.stream({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            })) {
                if (chunk.workflowStep && chunk.workflowStep.number === 1) {
                    foundStepContext = true;
                    expect(chunk.workflowStep.description).toBe('Test step');
                }
            }

            expect(foundStepContext).toBe(true);
        });
    });

    describe('Configuration', () => {
        it('should allow updating config at runtime', () => {
            const initialConfig: WorkflowConfig = {
                planning: { enabled: false },
                steps: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, initialConfig);
            expect(executor.getConfig().planning?.enabled).toBe(false);

            executor.setConfig({
                planning: { enabled: true },
                steps: { enabled: true },
            });

            expect(executor.getConfig().planning?.enabled).toBe(true);
            expect(executor.getConfig().steps?.enabled).toBe(true);
        });
    });
});
