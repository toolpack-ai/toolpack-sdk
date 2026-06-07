import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpChannel } from './mcp-channel.js';
import type { AgentInput, AgentOutput } from '../agent/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChannel(timeout?: number) {
    return new McpChannel({ timeout });
}

/** Wire a handler that immediately calls send() with the given output. */
function wireHandler(ch: McpChannel, output: string) {
    ch.onMessage(async (_input: AgentInput) => {
        await ch.send({ output });
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('McpChannel', () => {
    describe('listen()', () => {
        it('is a no-op and does not throw', () => {
            const ch = makeChannel();
            expect(() => ch.listen()).not.toThrow();
        });
    });

    describe('normalize()', () => {
        it('uses a string message field directly', () => {
            const ch = makeChannel();
            const input = ch.normalize({ message: 'review this PR' });
            expect(input.message).toBe('review this PR');
        });

        it('JSON-stringifies non-string args as message', () => {
            const ch = makeChannel();
            const input = ch.normalize({ pr_url: 'https://github.com/...' });
            expect(input.message).toBe(JSON.stringify({ pr_url: 'https://github.com/...' }));
        });

        it('sets data to the raw args', () => {
            const ch = makeChannel();
            const args = { pr_url: 'https://github.com/...', depth: 3 };
            const input = ch.normalize(args);
            expect(input.data).toEqual(args);
        });

        it('generates a unique conversationId per call', () => {
            const ch = makeChannel();
            const a = ch.normalize({});
            const b = ch.normalize({});
            expect(a.conversationId).not.toBe(b.conversationId);
        });
    });

    describe('trigger()', () => {
        it('resolves with agent output when send() is called', async () => {
            const ch = makeChannel();
            wireHandler(ch, 'LGTM — no issues found');
            const result = await ch.trigger({ pr_url: 'https://github.com/...' });
            expect(result).toBe('LGTM — no issues found');
        });

        it('passes normalized input to the handler', async () => {
            const ch = makeChannel();
            let received: AgentInput | undefined;
            ch.onMessage(async (input) => {
                received = input;
                await ch.send({ output: 'ok' });
            });
            await ch.trigger({ message: 'hello' });
            expect(received?.message).toBe('hello');
            expect(received?.data).toEqual({ message: 'hello' });
        });

        it('rejects when no handler is registered (timeout fires)', async () => {
            const ch = makeChannel(50); // short timeout so test completes fast
            // No handler registered — handleMessage is a no-op, send() never called
            await expect(ch.trigger({})).rejects.toThrow(/50ms/);
        });

        it('rejects after timeout when agent never calls send()', async () => {
            const ch = makeChannel(50); // 50ms timeout for fast test
            ch.onMessage(async () => { /* never calls send */ });
            await expect(ch.trigger({})).rejects.toThrow(/50ms/);
        });

        it('rejects when handleMessage throws', async () => {
            const ch = makeChannel();
            ch.onMessage(async () => { throw new Error('agent crashed'); });
            await expect(ch.trigger({})).rejects.toThrow('agent crashed');
        });
    });

    describe('asAgentDefinition()', () => {
        it('returns correct name and description', () => {
            const ch = makeChannel();
            const def = ch.asAgentDefinition({ name: 'pr_reviewer', description: 'Reviews PRs' });
            expect(def.name).toBe('pr_reviewer');
            expect(def.description).toBe('Reviews PRs');
        });

        it('includes inputSchema when provided', () => {
            const ch = makeChannel();
            const schema = { type: 'object', properties: { pr_url: { type: 'string' } } };
            const def = ch.asAgentDefinition({ name: 'x', description: 'y' }, schema);
            expect(def.inputSchema).toEqual(schema);
        });

        it('omits inputSchema when not provided', () => {
            const ch = makeChannel();
            const def = ch.asAgentDefinition({ name: 'x', description: 'y' });
            expect(def.inputSchema).toBeUndefined();
        });

        it('invoke() delegates to trigger()', async () => {
            const ch = makeChannel();
            wireHandler(ch, 'done');
            const def = ch.asAgentDefinition({ name: 'x', description: 'y' });
            const result = await def.invoke({ task: 'test' });
            expect(result).toBe('done');
        });
    });
});
