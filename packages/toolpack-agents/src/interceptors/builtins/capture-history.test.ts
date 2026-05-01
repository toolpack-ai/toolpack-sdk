import { describe, it, expect, vi } from 'vitest';
import { createCaptureInterceptor } from './capture-history.js';
import { InMemoryConversationStore } from '../../history/store.js';
import { composeChain, executeChain } from '../chain.js';
import { skip } from '../types.js';
import type { Interceptor } from '../types.js';

// ---------------------------------------------------------------------------
// Shared test helpers (inline to avoid cross-file deps)
// ---------------------------------------------------------------------------

function createMockAgent(name = 'kael') {
  return { name, description: 'test agent', mode: 'chat' } as any;
}

function createMockChannel() {
  return { isTriggerChannel: false, name: 'test', send: vi.fn(), listen: vi.fn(), onMessage: vi.fn(), normalize: vi.fn() } as any;
}

function createMockRegistry() {
  return {} as any;
}

/** Terminal agent invoker (replaces the real agent in tests). */
function makeTerminal(output = 'agent reply'): Interceptor {
  return async (_input, _ctx, _next) => ({ output, metadata: {} });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCaptureInterceptor', () => {
  it('writes the inbound message to the store before calling downstream', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hello',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
    });

    const stored = await store.get('conv-1');
    const userMsg = stored.find(m => m.participant.kind === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toBe('hello');
    expect(userMsg?.participant.id).toBe('u1');
  });

  it('writes the agent reply to the store after the chain resolves', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal('agent reply text')],
      createMockAgent('kael'),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hello',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
    });

    const stored = await store.get('conv-1');
    // Should have user message + agent reply
    expect(stored).toHaveLength(2);
    const agentMsg = stored.find(m => m.participant.kind === 'agent');
    expect(agentMsg?.content).toBe('agent reply text');
    expect(agentMsg?.participant.id).toBe('kael');
  });

  it('does NOT write an agent reply when the chain returns a skip sentinel', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    // Downstream skips (e.g. address-check decided to ignore)
    const skipInterceptor: Interceptor = async (_input, _ctx, _next) => skip();

    const chain = composeChain(
      [interceptor, skipInterceptor],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'Alice and Bob discussing lunch',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
    });

    const stored = await store.get('conv-1');
    // Inbound message captured, but no agent reply
    expect(stored).toHaveLength(1);
    expect(stored[0].participant.kind).toBe('user');
  });

  it('skips capture (but does not crash) when input has no conversationId', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    // No conversationId — the interceptor should still call next()
    const result = await executeChain(chain, {
      message: 'orphan message',
      participant: { kind: 'user', id: 'u1' },
    });

    // Chain completed (result is not null)
    expect(result).not.toBeNull();
    // Nothing written to any conversation
    expect(await store.get('conv-1')).toHaveLength(0);
  });

  it('skips capture when input has no participant', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'anonymous message',
      conversationId: 'conv-1',
      // No participant
    });

    // With no participant we cannot attribute the message, so nothing written
    const stored = await store.get('conv-1');
    const userMessages = stored.filter(m => m.participant.kind !== 'agent');
    expect(userMessages).toHaveLength(0);
  });

  it('calls onCaptured after each successful write', async () => {
    const store = new InMemoryConversationStore();
    const onCaptured = vi.fn();
    const interceptor = createCaptureInterceptor({ store, onCaptured });

    const chain = composeChain(
      [interceptor, makeTerminal('reply')],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hello',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
    });

    // Called once for inbound, once for agent reply
    expect(onCaptured).toHaveBeenCalledTimes(2);
  });

  it('captureAgentReplies: false suppresses the agent reply write', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store, captureAgentReplies: false });

    const chain = composeChain(
      [interceptor, makeTerminal('reply')],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hello',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
    });

    const stored = await store.get('conv-1');
    expect(stored).toHaveLength(1);
    expect(stored[0].participant.kind).toBe('user');
  });

  it('infers scope as "dm" from channelType "im"', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hey',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
      context: { channelType: 'im' },
    });

    const stored = await store.get('conv-1');
    expect(stored[0].scope).toBe('dm');
  });

  it('infers scope as "dm" from channelType "private" (Telegram DM)', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hey',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
      context: { channelType: 'private' },
    });

    const stored = await store.get('conv-1');
    expect(stored[0].scope).toBe('dm');
  });

  it('infers scope as "dm" from channelType "dm" (Discord DM)', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hey',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
      context: { channelType: 'dm' },
    });

    const stored = await store.get('conv-1');
    expect(stored[0].scope).toBe('dm');
  });

  it('infers scope as "channel" by default', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hey',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
    });

    const stored = await store.get('conv-1');
    expect(stored[0].scope).toBe('channel');
  });

  it('infers scope as "thread" when context.threadId is present', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'threaded reply',
      conversationId: 'thread-root-ts',
      participant: { kind: 'user', id: 'u1' },
      context: { threadId: 'thread-root-ts' },
    });

    const stored = await store.get('thread-root-ts');
    expect(stored[0].scope).toBe('thread');
  });

  it('uses a custom getMessageId when provided', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({
      store,
      getMessageId: () => 'fixed-id',
    });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hello',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
    });

    const stored = await store.get('conv-1');
    expect(stored[0].id).toBe('fixed-id');
  });

  it('writes channelName and channelId into stored message metadata', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hello',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
      context: { channelName: '#general', channelId: 'C123' },
    });

    const stored = await store.get('conv-1');
    expect(stored[0].metadata?.channelName).toBe('#general');
    expect(stored[0].metadata?.channelId).toBe('C123');
    // agent reply also inherits channel metadata
    expect(stored[1].metadata?.channelName).toBe('#general');
    expect(stored[1].metadata?.channelId).toBe('C123');
  });

  it('captures agent reply with empty string output', async () => {
    const store = new InMemoryConversationStore();
    const interceptor = createCaptureInterceptor({ store });

    const chain = composeChain(
      [interceptor, makeTerminal('')],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    await executeChain(chain, {
      message: 'hello',
      conversationId: 'conv-1',
      participant: { kind: 'user', id: 'u1' },
    });

    const stored = await store.get('conv-1');
    // Both inbound and reply should be stored
    expect(stored).toHaveLength(2);
    expect(stored[1].content).toBe('');
    expect(stored[1].participant.kind).toBe('agent');
  });

  it('does not crash when the store throws on append', async () => {
    const brokenStore = {
      append: vi.fn().mockRejectedValue(new Error('DB error')),
      get: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
    };
    const interceptor = createCaptureInterceptor({ store: brokenStore });

    const chain = composeChain(
      [interceptor, makeTerminal()],
      createMockAgent(),
      createMockChannel(),
      createMockRegistry()
    );

    // Should not throw even if the store is broken
    await expect(
      executeChain(chain, {
        message: 'hello',
        conversationId: 'conv-1',
        participant: { kind: 'user', id: 'u1' },
      })
    ).resolves.not.toThrow();
  });
});
