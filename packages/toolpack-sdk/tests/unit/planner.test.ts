import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Planner } from '../../src/workflows/planning/planner';
import { AIClient } from '../../src/client';
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

describe('Planner', () => {
    let mockProvider: MockProvider;
    let client: AIClient;

    beforeEach(() => {
        mockProvider = new MockProvider();
        client = new AIClient({
            providers: { mock: mockProvider },
            defaultProvider: 'mock',
        });
    });

    describe('createPlan', () => {
        it('should create a valid plan from AI response', async () => {
            const planner = new Planner(client, { enabled: true });

            const planJson = JSON.stringify({
                summary: 'Build a REST API',
                steps: [
                    { number: 1, description: 'Set up project structure', expectedTools: ['fs.write_file'] },
                    { number: 2, description: 'Create server file', expectedTools: ['fs.write_file'] },
                    { number: 3, description: 'Add routes', expectedTools: ['fs.write_file'] },
                ],
            });
            mockProvider.setResponse(planJson);

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Build me a REST API' }],
                model: 'test',
            });

            expect(plan).toBeDefined();
            expect(plan.summary).toBe('Build a REST API');
            expect(plan.steps).toHaveLength(3);
            expect(plan.steps[0].description).toBe('Set up project structure');
            expect(plan.steps[0].status).toBe('pending');
        });

        it('should assign unique IDs to each step', async () => {
            const planner = new Planner(client, { enabled: true });

            const planJson = JSON.stringify({
                summary: 'Test plan',
                steps: [
                    { number: 1, description: 'Step 1', expectedTools: [] },
                    { number: 2, description: 'Step 2', expectedTools: [] },
                ],
            });
            mockProvider.setResponse(planJson);

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(plan.steps[0].id).toBeDefined();
            expect(plan.steps[1].id).toBeDefined();
            expect(plan.steps[0].id).not.toBe(plan.steps[1].id);
        });

        it('should set plan status to draft initially', async () => {
            const planner = new Planner(client, { enabled: true });

            const planJson = JSON.stringify({
                summary: 'Draft test',
                steps: [{ number: 1, description: 'Step', expectedTools: [] }],
            });
            mockProvider.setResponse(planJson);

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(plan.status).toBe('draft');
        });

        it('should handle malformed JSON gracefully', async () => {
            const planner = new Planner(client, { enabled: true });

            // Invalid JSON response
            mockProvider.setResponse('This is not valid JSON');

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            // Should create a fallback single-step plan
            expect(plan).toBeDefined();
            expect(plan.steps.length).toBeGreaterThanOrEqual(1);
        });

        it('should respect maxSteps configuration', async () => {
            const planner = new Planner(client, { enabled: true, maxSteps: 3 });

            const planJson = JSON.stringify({
                summary: 'Too many steps',
                steps: [
                    { number: 1, description: 'Step 1', expectedTools: [] },
                    { number: 2, description: 'Step 2', expectedTools: [] },
                    { number: 3, description: 'Step 3', expectedTools: [] },
                    { number: 4, description: 'Step 4', expectedTools: [] },
                    { number: 5, description: 'Step 5', expectedTools: [] },
                ],
            });
            mockProvider.setResponse(planJson);

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            // Should truncate to maxSteps
            expect(plan.steps.length).toBeLessThanOrEqual(3);
        });
    });

    describe('createPlan', () => {
        it('should create a single-step plan', async () => {
            const planner = new Planner(client, { enabled: false });

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Simple task' }],
                model: 'test',
            });

            expect(plan).toBeDefined();
            expect(plan.steps.length).toBeGreaterThanOrEqual(1);
            expect(plan.status).toBe('draft');
        });
    });

    describe('Plan Structure', () => {
        it('should include timestamps', async () => {
            const planner = new Planner(client, { enabled: true });

            const planJson = JSON.stringify({
                summary: 'Timestamp test',
                steps: [{ number: 1, description: 'Step', expectedTools: [] }],
            });
            mockProvider.setResponse(planJson);

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Test' }],
                model: 'test',
            });

            expect(plan.createdAt).toBeInstanceOf(Date);
        });

        it('should include original request in plan', async () => {
            const planner = new Planner(client, { enabled: true });

            const planJson = JSON.stringify({
                summary: 'Request test',
                steps: [{ number: 1, description: 'Step', expectedTools: [] }],
            });
            mockProvider.setResponse(planJson);

            const plan = await planner.createPlan({
                messages: [{ role: 'user', content: 'Build a website' }],
                model: 'test',
            });

            expect(plan.request).toContain('Build a website');
        });
    });
});
