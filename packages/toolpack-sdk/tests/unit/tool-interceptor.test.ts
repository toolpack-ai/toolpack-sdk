import { describe, it, expect } from 'vitest';
import { AIClient } from '../../src/client';
import { ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingResponse } from '../../src/providers/base';
import type { ToolInterceptor } from '../../src/types';

// Asks for `work` in each of `rounds` rounds (two parallel calls in the first one when `parallel`), then answers with the last tool result.
class RoundsProvider extends ProviderAdapter {
    seenByProvider: CompletionRequest[] = [];
    constructor(private rounds: number, private parallel = false) { super(); }
    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        this.seenByProvider.push(request);
        const results = request.messages.filter(m => m.role === 'tool');
        const done = results.length >= this.rounds + (this.parallel ? 1 : 0);
        if (done) return { content: `last: ${String(results[results.length - 1]!.content)}`, finish_reason: 'stop' };
        const round = request.messages.filter(m => m.role === 'assistant').length + 1;
        const calls = [{ id: `call-${round}`, name: 'work', arguments: { n: round } }];
        if (this.parallel && round === 1) calls.push({ id: `call-${round}b`, name: 'work', arguments: { n: round } });
        return { content: '', finish_reason: 'tool_calls', tool_calls: calls };
    }
    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        this.seenByProvider.push(request);
        const results = request.messages.filter(m => m.role === 'tool');
        if (results.length >= this.rounds) { yield { delta: `last: ${String(results[results.length - 1]!.content)}`, finish_reason: 'stop' }; return; }
        const round = request.messages.filter(m => m.role === 'assistant').length + 1;
        yield { delta: '', finish_reason: 'tool_calls', tool_calls: [{ id: `call-${round}`, name: 'work', arguments: { n: round } }] };
    }
    async embed(): Promise<EmbeddingResponse> { return { embeddings: [] }; }
}

function run(provider: RoundsProvider, interceptTool?: ToolInterceptor, executed: string[] = []) {
    const client = new AIClient({ providers: { mock: provider }, defaultProvider: 'mock', disableBaseContext: true });
    return client.generate({
        messages: [{ role: 'user', content: 'go' }],
        model: 'test-model',
        interceptTool,
        requestTools: [{
            name: 'work', displayName: 'Work', description: 'Does work', category: 'test',
            parameters: { type: 'object', properties: { n: { type: 'number' } } },
            execute: async (args) => { executed.push(`work-${args.n}`); return `done ${args.n}`; },
        }],
    });
}

describe('interceptTool', () => {
    it('changes nothing when it is not set', async () => {
        const executed: string[] = [];
        const res = await run(new RoundsProvider(2), undefined, executed);
        expect(executed).toEqual(['work-1', 'work-2']);
        expect(res.content).toBe('last: done 2');
    });

    it('sees every call with its tool name, arguments and round', async () => {
        const seen: unknown[] = [];
        await run(new RoundsProvider(2, true), async (call, next) => { seen.push(call); return next(); });
        expect(seen).toEqual([
            { toolName: 'work', args: { n: 1 }, round: 1 },
            { toolName: 'work', args: { n: 1 }, round: 1 },
            { toolName: 'work', args: { n: 2 }, round: 2 },
        ]);
    });

    it('stops a call: the tool does not run and the model gets the text as the result', async () => {
        const executed: string[] = [];
        const res = await run(new RoundsProvider(3), async (call, next) => (call.round === 3 ? 'Step limit reached.' : next()), executed);
        expect(executed).toEqual(['work-1', 'work-2']);
        expect(res.content).toBe('last: Step limit reached.');
    });

    it('can change a result after the tool ran', async () => {
        const res = await run(new RoundsProvider(1), async (_call, next) => `${await next()} (2 calls left)`);
        expect(res.content).toBe('last: done 1 (2 calls left)');
    });

    it('works the same when streaming', async () => {
        const executed: string[] = [];
        const provider = new RoundsProvider(3);
        const client = new AIClient({ providers: { mock: provider }, defaultProvider: 'mock', disableBaseContext: true });
        let text = '';
        for await (const chunk of client.stream({
            messages: [{ role: 'user', content: 'go' }], model: 'test-model',
            interceptTool: async (call, next) => (call.round === 3 ? 'Step limit reached.' : next()),
            requestTools: [{ name: 'work', displayName: 'Work', description: 'w', category: 'test', parameters: { type: 'object', properties: {} }, execute: async (a) => { executed.push(`work-${a.n}`); return `done ${a.n}`; } }],
        })) text += chunk.delta;
        expect(executed).toEqual(['work-1', 'work-2']);
        expect(text).toContain('last: Step limit reached.');
        for (const req of provider.seenByProvider) expect((req as any).interceptTool).toBeUndefined();
    });

    it('is not sent to the provider', async () => {
        const provider = new RoundsProvider(1);
        await run(provider, async (_call, next) => next());
        expect(provider.seenByProvider.length).toBeGreaterThan(0);
        for (const req of provider.seenByProvider) expect((req as any).interceptTool).toBeUndefined();
    });

    it('is not sent to the provider in the final call after the round cap either', async () => {
        const provider = new RoundsProvider(5);
        const client = new AIClient({ providers: { mock: provider }, defaultProvider: 'mock', disableBaseContext: true });
        await client.generate({
            messages: [{ role: 'user', content: 'go' }], model: 'test-model', maxToolRounds: 1,
            interceptTool: async (_c, next) => next(),
            requestTools: [{ name: 'work', displayName: 'Work', description: 'w', category: 'test', parameters: { type: 'object', properties: {} }, execute: async () => 'ok' }],
        });
        expect(provider.seenByProvider.length).toBeGreaterThanOrEqual(3);
        for (const req of provider.seenByProvider) expect((req as any).interceptTool).toBeUndefined();
    });

    it('is not asked once the run was stopped', async () => {
        const controller = new AbortController();
        controller.abort();
        const client = new AIClient({ providers: { mock: new RoundsProvider(1) }, defaultProvider: 'mock', disableBaseContext: true });
        let asked = false;
        await expect(client.generate({
            messages: [{ role: 'user', content: 'go' }], model: 'test-model', signal: controller.signal,
            interceptTool: async (_c, next) => { asked = true; return next(); },
        })).rejects.toBeDefined();
        expect(asked).toBe(false);
    });
});
