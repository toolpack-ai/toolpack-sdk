import { describe, it, expect } from 'vitest';
import { AbortedError, raceAbort, untilAborted } from './abort.js';
import { AIClient } from '../client/index.js';
import { ProviderAdapter } from '../providers/base/index.js';
import { ToolRegistry } from '../tools/registry.js';
import { DEFAULT_TOOLS_CONFIG } from '../tools/types.js';
import { RateLimitError } from '../errors/index.js';
import { withRetry } from './retry.js';
import type { CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse } from '../types/index.js';

const never = <T>() => new Promise<T>(() => {});
const soon = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('raceAbort', () => {
    it('gives the result when nothing is aborted', async () => {
        expect(await raceAbort(Promise.resolve(7), new AbortController().signal)).toBe(7);
        expect(await raceAbort(Promise.resolve(7))).toBe(7);
    });

    it('passes on a failure of the call itself', async () => {
        await expect(raceAbort(Promise.reject(new Error('boom')), new AbortController().signal)).rejects.toThrow('boom');
    });

    it('rejects at once when the signal is aborted, also while the call never ends', async () => {
        const controller = new AbortController();
        const result = raceAbort(never<number>(), controller.signal);
        controller.abort();
        await expect(result).rejects.toBeInstanceOf(AbortedError);
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects when the signal was already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(raceAbort(Promise.resolve(1), controller.signal)).rejects.toBeInstanceOf(AbortedError);
    });

    it('a call that fails after the stop does not become an unhandled rejection', async () => {
        const controller = new AbortController();
        let fail!: (e: Error) => void;
        const call = new Promise<number>((_resolve, reject) => { fail = reject; });
        const result = raceAbort(call, controller.signal);
        controller.abort();
        await expect(result).rejects.toBeInstanceOf(AbortedError);
        fail(new Error('late'));
        await soon(5);
    });
});

describe('untilAborted', () => {
    it('yields everything when nothing is aborted', async () => {
        async function* source() { yield 1; yield 2; }
        const seen: number[] = [];
        for await (const n of untilAborted(source(), new AbortController().signal)) seen.push(n);
        expect(seen).toEqual([1, 2]);
    });

    it('ends quietly when aborted while waiting for the next item, and tells the source to finish', async () => {
        const controller = new AbortController();
        let finished = false;
        const source: AsyncIterable<number> = {
            [Symbol.asyncIterator]: () => {
                let sent = false;
                return {
                    next: () => (sent ? never<IteratorResult<number>>() : (sent = true, Promise.resolve({ done: false, value: 1 }))),
                    return: async () => { finished = true; return { done: true, value: undefined }; },
                };
            },
        };
        const seen: number[] = [];
        setTimeout(() => controller.abort(), 20);
        for await (const n of untilAborted(source, controller.signal)) seen.push(n);
        expect(seen).toEqual([1]);
        expect(finished).toBe(true);
    });

    it('tells the source to finish when the reader leaves early', async () => {
        let cleaned = false;
        async function* source() { try { yield 1; yield 2; yield 3; } finally { cleaned = true; } }
        for await (const n of untilAborted(source(), new AbortController().signal)) { if (n === 1) break; }
        await soon(5);
        expect(cleaned).toBe(true);
    });

    it('passes on a failure of the source', async () => {
        async function* source(): AsyncGenerator<number> { yield 1; throw new Error('boom'); }
        const run = async () => { for await (const _ of untilAborted(source(), new AbortController().signal)) { /* read */ } };
        await expect(run()).rejects.toThrow('boom');
    });
});

describe('withRetry with a signal', () => {
    it('ends the wait for a retry at once, and starts no further attempt', async () => {
        const controller = new AbortController();
        let attempts = 0;
        const started = Date.now();
        setTimeout(() => controller.abort(), 20);
        const run = withRetry(async () => { attempts++; throw new RateLimitError('slow down', 5); }, { signal: controller.signal });
        await expect(run).rejects.toBeInstanceOf(AbortedError);
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(attempts).toBe(1);
    });
});

// A provider whose call takes far longer than the test, and does not look at the signal itself.
class SlowProvider extends ProviderAdapter {
    name = 'slow';
    calls = 0;
    async generate(_request: CompletionRequest): Promise<CompletionResponse> {
        this.calls++;
        await soon(5_000);
        return { content: 'late', usage: { prompt_tokens: 1, total_tokens: 1 } };
    }
    async *stream(_request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        this.calls++;
        yield { delta: 'first' };
        await soon(5_000);
        yield { delta: 'late' };
    }
    async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> { throw new Error('not used'); }
}

describe('AIClient: a stop while the provider call is under way', () => {
    const build = () => {
        const provider = new SlowProvider();
        return { provider, client: new AIClient({ providers: { slow: provider }, defaultProvider: 'slow' }) };
    };
    const request = (signal: AbortSignal): CompletionRequest => ({ model: 'm', messages: [{ role: 'user', content: 'hi' }], signal });

    it('generate() rejects with an AbortError at once, without waiting for the call', async () => {
        const { client, provider } = build();
        const controller = new AbortController();
        const started = Date.now();
        setTimeout(() => controller.abort(), 30);
        await expect(client.generate(request(controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(provider.calls).toBe(1);
    });

    it('stream() does not run a tool whose call had arrived before the stop', async () => {
        let ran = false;
        const registry = new ToolRegistry();
        registry.register({
            name: 'side.effect', displayName: 'side.effect', category: 'test', description: 'Has an effect',
            parameters: { type: 'object', properties: {} },
            execute: async () => { ran = true; return 'done'; },
        });
        class ToolThenSlow extends SlowProvider {
            async *stream(_request: CompletionRequest): AsyncGenerator<CompletionChunk> {
                yield { delta: '', tool_calls: [{ id: 'c1', name: 'side.effect', arguments: {} }] } as CompletionChunk;
                await soon(5_000);
            }
        }
        const client = new AIClient({
            providers: { slow: new ToolThenSlow() }, defaultProvider: 'slow', toolRegistry: registry,
            toolsConfig: { ...DEFAULT_TOOLS_CONFIG, enabled: true, autoExecute: true },
        });
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 30);
        for await (const _ of client.stream(request(controller.signal))) { /* read */ }
        await soon(20);
        expect(ran).toBe(false);
    });

    it('generate() does not start another call after the stop (a rate limit retry)', async () => {
        class RateLimited extends SlowProvider {
            async generate(_request: CompletionRequest): Promise<CompletionResponse> {
                this.calls++;
                throw new RateLimitError('slow down', 0.05);
            }
        }
        const provider = new RateLimited();
        const client = new AIClient({ providers: { slow: provider }, defaultProvider: 'slow' });
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10);
        await expect(client.generate(request(controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
        await soon(150); // well past the retry wait
        expect(provider.calls).toBe(1);
    });

    it('stream() ends with one last chunk that says it was stopped, and does not throw', async () => {
        const { client } = build();
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 30);
        const chunks: CompletionChunk[] = [];
        for await (const chunk of client.stream(request(controller.signal))) chunks.push(chunk);
        expect(chunks[chunks.length - 1]).toEqual({ delta: '', finish_reason: 'aborted' });
    });

    // A provider that asks for the given tools on every call. The calls share a path, so they run one after the other.
    const withTools = (tools: Record<string, (ctx: any) => Promise<string>>, maxToolRounds = 5) => {
        const registry = new ToolRegistry();
        for (const [name, run] of Object.entries(tools)) {
            registry.register({
                name, displayName: name, category: 'test', description: name,
                parameters: { type: 'object', properties: {} },
                execute: async (_args: any, ctx: any) => run(ctx),
            });
        }
        class AsksForTools extends SlowProvider {
            async generate(_request: CompletionRequest): Promise<CompletionResponse> {
                this.calls++;
                return {
                    content: '', usage: { prompt_tokens: 1, total_tokens: 1 },
                    tool_calls: Object.keys(tools).map((name, i) => ({ id: `c${this.calls}_${i}`, name, arguments: { path: 'same' } })),
                };
            }
        }
        const provider = new AsksForTools();
        const client = new AIClient({
            providers: { slow: provider }, defaultProvider: 'slow', toolRegistry: registry,
            toolsConfig: { ...DEFAULT_TOOLS_CONFIG, enabled: true, autoExecute: true, maxToolRounds },
        });
        return { client, provider };
    };

    it('generate() does not wait for a running tool, and does not start the next one', async () => {
        let secondRan = false;
        let seenSignal: AbortSignal | undefined;
        const { client, provider } = withTools({
            'first.slow': async (ctx) => { seenSignal = ctx.signal; await soon(5_000); return 'late'; },
            'second.effect': async () => { secondRan = true; return 'done'; },
        });
        const controller = new AbortController();
        const started = Date.now();
        setTimeout(() => controller.abort(), 30);
        await expect(client.generate(request(controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
        expect(Date.now() - started).toBeLessThan(1_000);
        await soon(20);
        expect(secondRan).toBe(false);
        expect(seenSignal?.aborted).toBe(true); // the tool was given the signal, and can end its own work
        expect(provider.calls).toBe(1);
    });

    it('generate() rejects when stopped during the closing call after the tool round cap', async () => {
        class CapThenSlow extends SlowProvider {
            async generate(request: CompletionRequest): Promise<CompletionResponse> {
                this.calls++;
                // The closing call is the one made without tools.
                if (this.calls > 1 && !(request.tools?.length)) { await soon(5_000); return { content: 'late', usage: { prompt_tokens: 1, total_tokens: 1 } }; }
                return { content: '', usage: { prompt_tokens: 1, total_tokens: 1 }, tool_calls: [{ id: `c${this.calls}`, name: 'quick.tool', arguments: {} }] };
            }
        }
        const registry = new ToolRegistry();
        registry.register({
            name: 'quick.tool', displayName: 'quick.tool', category: 'test', description: 'Quick',
            parameters: { type: 'object', properties: {} },
            execute: async () => 'ok',
        });
        const client = new AIClient({
            providers: { slow: new CapThenSlow() }, defaultProvider: 'slow', toolRegistry: registry,
            toolsConfig: { ...DEFAULT_TOOLS_CONFIG, enabled: true, autoExecute: true },
        });
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 100);
        await expect(client.generate({ ...request(controller.signal), maxToolRounds: 1 })).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('stream() ends at once, with what had arrived', async () => {
        const { client } = build();
        const controller = new AbortController();
        const started = Date.now();
        setTimeout(() => controller.abort(), 30);
        let text = '';
        for await (const chunk of client.stream(request(controller.signal))) text += chunk.delta ?? '';
        expect(text).toBe('first');
        expect(Date.now() - started).toBeLessThan(1_000);
    });
});
