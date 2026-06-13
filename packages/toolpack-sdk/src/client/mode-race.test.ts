/**
 * Regression tests for the mode race on shared AIClient instances.
 *
 * Bug: activeMode is instance-level state read live during a request. When two
 * agents share one Toolpack/AIClient, agent B's setMode() can interleave with
 * agent A's in-flight run in two observable ways:
 *
 *  1. Pre-generate window — BaseAgent.run() calls setMode(modeA), then awaits
 *     (mind init, history assembly) before generate(). A concurrent
 *     setMode(modeB) in that window made A's ENTIRE request (system prompt +
 *     tool filtering) run under mode B.
 *
 *  2. Mid-loop tool.search — executeToolSearch filtered results by the live
 *     activeMode. After an awaited delegation flipped the mode, the caller's
 *     later tool.search rounds returned the SUB-AGENT's allowed tools.
 *
 * Fix: requests carry a per-request `mode` (snapshotted via resolveRequestMode
 * at generate()/stream() start) that is threaded through every enrichment,
 * injection, and tool.search execution for the duration of the request.
 */

import { describe, it, expect } from 'vitest';
import { AIClient } from './index.js';
import { ToolRegistry } from '../tools/registry.js';
import { DEFAULT_TOOLS_CONFIG } from '../tools/types.js';
import type { ToolDefinition } from '../tools/types.js';
import { createMode } from '../modes/index.js';
import { ProviderAdapter } from '../providers/base/index.js';
import type {
    CompletionRequest,
    CompletionResponse,
    CompletionChunk,
    EmbeddingRequest,
    EmbeddingResponse,
    Message,
} from '../types/index.js';

// ─── Fake provider ────────────────────────────────────────────────────────────
// Records the tool set and messages sent on each call and returns scripted
// responses (e.g. call 1 → a tool_call, call 2 → plain content ending the loop).

class ScriptedProvider extends ProviderAdapter {
    name = 'scripted';
    /** Tool names sent to the provider, per call, in order. */
    toolsPerCall: string[][] = [];
    /** Messages sent to the provider, per call, in order. */
    messagesPerCall: Message[][] = [];

    constructor(private script: CompletionResponse[]) {
        super();
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        this.toolsPerCall.push((request.tools ?? []).map(t => t.function.name));
        this.messagesPerCall.push(request.messages);
        const response = this.script.shift();
        if (!response) throw new Error('ScriptedProvider: script exhausted');
        return response;
    }

    // eslint-disable-next-line require-yield
    async *stream(_request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        throw new Error('not used');
    }

    async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
        throw new Error('not used');
    }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MODE_A = createMode({
    name: 'mode-a',
    displayName: 'Mode A',
    systemPrompt: 'You are agent A.',
    allowedToolCategories: ['alpha', 'agent'],
});

const MODE_B = createMode({
    name: 'mode-b',
    displayName: 'Mode B',
    systemPrompt: 'You are agent B.',
    allowedToolCategories: ['beta'],
});

function makeTool(name: string, category: string, execute: ToolDefinition['execute']): ToolDefinition {
    return {
        name,
        displayName: name,
        category,
        description: `Test tool ${name}`,
        parameters: { type: 'object', properties: {} },
        execute,
    };
}

interface HarnessOptions {
    script: CompletionResponse[];
    /** Runs inside agent.delegate's execute() — simulates the sub-agent's run. */
    onDelegate?: (client: AIClient) => void;
    toolSearchEnabled?: boolean;
}

/**
 * Client with three registry tools:
 *   alpha.notify   (category alpha — allowed by mode A only)
 *   beta.scan      (category beta  — allowed by mode B only)
 *   agent.delegate (category agent — allowed by mode A; its execute() runs
 *                   `onDelegate`, simulating an awaited sub-agent run)
 */
function buildHarness(opts: HarnessOptions): { client: AIClient; provider: ScriptedProvider } {
    const registry = new ToolRegistry();

    registry.register(makeTool('alpha.notify', 'alpha', async () => JSON.stringify({ ok: true })));
    registry.register(makeTool('beta.scan', 'beta', async () => JSON.stringify({ ok: true })));

    const holder: { client?: AIClient } = {};
    registry.register(makeTool('agent.delegate', 'agent', async () => {
        opts.onDelegate?.(holder.client!);
        return JSON.stringify({ delegated: true });
    }));

    const provider = new ScriptedProvider(opts.script);
    const client = new AIClient({
        providers: { scripted: provider },
        defaultProvider: 'scripted',
        toolRegistry: registry,
        toolsConfig: {
            ...DEFAULT_TOOLS_CONFIG,
            enabled: true,
            autoExecute: true,
            maxToolRounds: 4,
            toolSearch: {
                ...DEFAULT_TOOLS_CONFIG.toolSearch,
                enabled: opts.toolSearchEnabled ?? false,
            },
        },
    });
    holder.client = client;

    return { client, provider };
}

const finalResponse: CompletionResponse = {
    content: 'done',
    usage: { prompt_tokens: 1, total_tokens: 1 },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AIClient per-request mode snapshot (shared-instance race)', () => {
    it('pins the request to its mode even when setMode() changes between run setup and generate()', async () => {
        // The real-world sequence in BaseAgent.run():
        //   A: setMode(modeA) → await mind/history setup → generate()
        // and during that await, a concurrent agent does setMode(modeB).
        // Pre-fix, A's whole request ran under mode B (wrong system prompt,
        // wrong tool filtering). The per-request `mode` pins it to A.
        const { client, provider } = buildHarness({ script: [finalResponse] });

        client.setMode(MODE_A);
        // …interleaving await happens here, during which another agent flips the mode:
        client.setMode(MODE_B);

        await client.generate({
            messages: [{ role: 'user', content: 'notify the team' }],
            model: 'test-model',
            mode: MODE_A, // BaseAgent.run() now always passes its own mode
        });

        // Tool filtering must follow mode A, not the live instance state (B).
        expect(provider.toolsPerCall[0]).toContain('alpha.notify');
        expect(provider.toolsPerCall[0]).toContain('agent.delegate');
        expect(provider.toolsPerCall[0]).not.toContain('beta.scan');

        // System prompt must be mode A's, not mode B's.
        const systemText = provider.messagesPerCall[0]
            .filter(m => m.role === 'system')
            .map(m => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
        expect(systemText).toContain('You are agent A.');
        expect(systemText).not.toContain('You are agent B.');
    });

    it('filters mid-loop tool.search results by the request mode, not the live mode', async () => {
        // Round 1: model calls agent.delegate → the "sub-agent" flips the shared
        //          instance to mode B during execution.
        // Round 2: model calls tool.search — pre-fix this filtered results by
        //          the LIVE mode (B), hiding every alpha tool from the caller.
        // Round 3: final answer.
        const { client, provider } = buildHarness({
            script: [
                {
                    content: '',
                    tool_calls: [{ id: 'c1', name: 'agent.delegate', arguments: {} }],
                    usage: { prompt_tokens: 1, total_tokens: 1 },
                },
                {
                    content: '',
                    tool_calls: [{ id: 'c2', name: 'tool.search', arguments: { query: 'notify' } }],
                    usage: { prompt_tokens: 1, total_tokens: 1 },
                },
                finalResponse,
            ],
            onDelegate: (c) => c.setMode(MODE_B),
            toolSearchEnabled: true,
        });

        client.setMode(MODE_A);
        const result = await client.generate({
            messages: [{ role: 'user', content: 'delegate, then find a notify tool' }],
            model: 'test-model',
            mode: MODE_A,
        });
        expect(result.content).toBe('done');

        // The tool.search result is delivered to the model as a tool message in
        // the round-3 request. It must contain alpha.notify (allowed by mode A) —
        // pre-fix it was filtered by mode B and came back empty.
        const round3ToolMessages = provider.messagesPerCall[2]
            .filter(m => m.role === 'tool')
            .map(m => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
        expect(round3ToolMessages).toContain('alpha.notify');

        // Sanity: the instance-level mode DID flip (back-compat for getMode readers);
        // only the in-flight request was isolated from it.
        expect(client.getMode()?.name).toBe('mode-b');
    });

    it('uses a per-request mode override instead of the active mode', async () => {
        const { client, provider } = buildHarness({ script: [finalResponse] });

        client.setMode(MODE_B); // instance state says B…
        await client.generate({
            messages: [{ role: 'user', content: 'hi' }],
            model: 'test-model',
            mode: MODE_A, // …but the request pins A
        });

        expect(provider.toolsPerCall[0]).toContain('alpha.notify');
        expect(provider.toolsPerCall[0]).not.toContain('beta.scan');
    });

    it('runs without mode filtering when the request passes mode: null', async () => {
        const { client, provider } = buildHarness({ script: [finalResponse] });

        client.setMode(MODE_B);
        await client.generate({
            messages: [{ role: 'user', content: 'hi' }],
            model: 'test-model',
            mode: null,
        });

        // No mode → no category filtering: every registry tool goes out.
        expect(provider.toolsPerCall[0]).toContain('alpha.notify');
        expect(provider.toolsPerCall[0]).toContain('beta.scan');
        expect(provider.toolsPerCall[0]).toContain('agent.delegate');
    });

    it('falls back to the active mode snapshot when no request mode is given', async () => {
        const { client, provider } = buildHarness({ script: [finalResponse] });

        client.setMode(MODE_A);
        await client.generate({
            messages: [{ role: 'user', content: 'hi' }],
            model: 'test-model',
        });

        expect(provider.toolsPerCall[0]).toContain('alpha.notify');
        expect(provider.toolsPerCall[0]).not.toContain('beta.scan');
    });
});
