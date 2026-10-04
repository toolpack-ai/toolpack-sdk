import { describe, it, expect } from 'vitest';
import { AIClient } from '../../src/client';
import { ProviderAdapter, CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingResponse } from '../../src/providers/base';
import type { ToolActor, ToolContext } from '../../src/tools/types';

// Asks for the `whoami` tool once, then answers with the tool's result.
class ToolCallingProvider extends ProviderAdapter {
    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        const toolResult = request.messages.find(m => m.role === 'tool');
        if (toolResult) return { content: String(toolResult.content), finish_reason: 'stop' };
        return { content: '', finish_reason: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'whoami', arguments: { actor: 'someone-else' } }] };
    }
    async *stream(): AsyncGenerator<CompletionChunk> {
        yield { delta: '', finish_reason: 'stop' };
    }
    async embed(): Promise<EmbeddingResponse> {
        return { embeddings: [] };
    }
}

/** Runs one request whose model calls `whoami`, and returns the context that tool received. */
async function contextSeenByTool(actor?: ToolActor | (() => ToolActor | null | undefined)): Promise<ToolContext | undefined> {
    let seen: ToolContext | undefined;
    const client = new AIClient({ providers: { mock: new ToolCallingProvider() }, defaultProvider: 'mock', disableBaseContext: true, actor });
    await client.generate({
        messages: [{ role: 'user', content: 'who am I?' }],
        model: 'test-model',
        requestTools: [{
            name: 'whoami',
            displayName: 'Who am I',
            description: 'Returns the actor',
            category: 'test',
            parameters: { type: 'object', properties: {} },
            execute: async (_args, ctx) => { seen = ctx; return 'ok'; },
        }],
    });
    return seen;
}

describe('ToolContext.actor', () => {
    it('gives every tool call the actor the host set', async () => {
        const ctx = await contextSeenByTool({ id: 'user-1', kind: 'user' });
        expect(ctx?.actor).toEqual({ id: 'user-1', kind: 'user' });
    });

    it('is absent when the host set none, whatever the model passes as arguments', async () => {
        const ctx = await contextSeenByTool();
        expect(ctx).toBeDefined();
        expect(ctx?.actor).toBeUndefined();
    });

    it('reads a function on each call, so one instance can serve several actors', async () => {
        let current: ToolActor | null = { id: 'user-1' };
        expect((await contextSeenByTool(() => current))?.actor).toEqual({ id: 'user-1' });
        current = null;
        expect((await contextSeenByTool(() => current))?.actor).toBeUndefined();
    });
});
