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
        it('should execute directly when planning is disabled', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: false },
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

    describe('Plan-Direct Execution', () => {
        it('should create a plan and execute in one call when planning is enabled', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
            };

            const executor = new WorkflowExecutor(client, config);

            const planJson = JSON.stringify({
                summary: 'Test plan',
                steps: [
                    { number: 1, description: 'Step 1', expectedTools: [] },
                ],
            });
            mockProvider.setResponses([planJson, 'Execution result']);

            const planCreatedHandler = vi.fn();
            executor.on('workflow:plan_created', planCreatedHandler);

            const result = await executor.execute({
                messages: [{ role: 'user', content: 'Create something' }],
                model: 'test',
            });

            expect(result.success).toBe(true);
            expect(result.output).toBe('Execution result');
            expect(planCreatedHandler).toHaveBeenCalled();
            const plan = planCreatedHandler.mock.calls[0][0] as Plan;
            expect(plan.summary).toBe('Test plan');
        });

        it('should wait for approval when requireApproval is true', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: true },
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

        it('should emit progress events during plan-direct execution', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
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

    describe('Streaming Execution', () => {
        it('should stream plan-direct execution', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: true, requireApproval: false },
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
            const textChunks = chunks.filter(c => c.delta);
            expect(textChunks.some(c => c.delta === 'Streamed content')).toBe(true);
        });

        it('should stream directly when planning is disabled', async () => {
            const config: WorkflowConfig = {
                planning: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, config);
            mockProvider.setResponses(['Direct streamed content']);

            const chunks: any[] = [];
            for await (const chunk of executor.stream({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            })) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks.some(c => c.delta === 'Direct streamed content')).toBe(true);
        });
    });

    describe('Configuration', () => {
        it('should allow updating config at runtime', () => {
            const initialConfig: WorkflowConfig = {
                planning: { enabled: false },
            };

            const executor = new WorkflowExecutor(client, initialConfig);
            expect(executor.getConfig().planning?.enabled).toBe(false);

            executor.setConfig({
                planning: { enabled: true },
            });

            expect(executor.getConfig().planning?.enabled).toBe(true);
        });
    });
});
