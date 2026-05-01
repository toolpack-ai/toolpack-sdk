import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentInput, AgentResult, AgentInstance, ChannelInterface, IAgentRegistry } from '../../agent/types.js';
import { composeChain, executeChain } from '../chain.js';
import { SKIP_SENTINEL, isSkipSentinel, type Interceptor } from '../types.js';

import { createEventDedupInterceptor } from './event-dedup.js';
import { createNoiseFilterInterceptor } from './noise-filter.js';
import { createSelfFilterInterceptor } from './self-filter.js';
import { createRateLimitInterceptor } from './rate-limit.js';
import { createParticipantResolverInterceptor } from './participant-resolver.js';
import { createAddressCheckInterceptor, isAgentNameOnlyInCodeBlocks, type AddressCheckResult } from './address-check.js';
import { createDepthGuardInterceptor, DepthExceededError } from './depth-guard.js';
import { createTracerInterceptor } from './tracer.js';
import { createIntentClassifierInterceptor } from './intent-classifier.js';

// ---------- Test helpers ----------

function createMockAgent(name: string, result: AgentResult = { output: 'ok' }): AgentInstance {
  return {
    name,
    description: `Mock ${name}`,
    mode: 'chat',
    invokeAgent: vi.fn().mockResolvedValue(result),
  } as unknown as AgentInstance;
}

function createMockChannel(name: string = 'test-channel'): ChannelInterface {
  return {
    name,
    isTriggerChannel: false,
    listen: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    normalize: vi.fn(),
    onMessage: vi.fn(),
  };
}

function createMockRegistry(agents: Map<string, AgentInstance> = new Map()): IAgentRegistry {
  return {
    start: vi.fn(),
    sendTo: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn((name: string) => agents.get(name)),
    getAllAgents: vi.fn(() => Array.from(agents.values())),
    getPendingAsk: vi.fn(),
    addPendingAsk: vi.fn(),
    resolvePendingAsk: vi.fn().mockResolvedValue(undefined),
    hasPendingAsks: vi.fn(),
    incrementRetries: vi.fn(),
    cleanupExpiredAsks: vi.fn().mockReturnValue(0),
  } as unknown as IAgentRegistry;
}

/**
 * Run a single interceptor with a minimal chain setup and return the chain's result.
 */
async function runInterceptor(
  interceptor: Interceptor,
  input: AgentInput,
  agentResult: AgentResult = { output: 'agent-ran' }
) {
  const agent = createMockAgent('test-agent', agentResult);
  const channel = createMockChannel();
  const registry = createMockRegistry();
  const chain = composeChain([interceptor], agent, channel, registry);
  const result = await executeChain(chain, input);
  return { result, agent, channel, registry };
}

// ---------- event-dedup ----------

describe('createEventDedupInterceptor', () => {
  it('allows first occurrence of an event through', async () => {
    const interceptor = createEventDedupInterceptor();
    const input: AgentInput = {
      message: 'hi',
      conversationId: 'c1',
      context: { eventId: 'evt-1' },
    };
    const { result, agent } = await runInterceptor(interceptor, input);

    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it('skips duplicate events', async () => {
    const interceptor = createEventDedupInterceptor();
    const onDuplicate = vi.fn();
    const dedupWithCb = createEventDedupInterceptor({ onDuplicate });

    const agent = createMockAgent('test-agent');
    const chain = composeChain([dedupWithCb], agent, createMockChannel(), createMockRegistry());
    const input: AgentInput = {
      message: 'hi',
      conversationId: 'c1',
      context: { eventId: 'evt-1' },
    };

    const first = await executeChain(chain, input);
    const second = await executeChain(chain, input);

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // skipped
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith('evt-1', input);
  });

  it('treats missing eventId as always fresh', async () => {
    const interceptor = createEventDedupInterceptor();
    const input: AgentInput = { message: 'hi', conversationId: 'c1' };

    const { result: r1 } = await runInterceptor(interceptor, input);
    const { result: r2 } = await runInterceptor(interceptor, input);

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
  });

  it('evicts oldest entries when maxCacheSize reached (LRU)', async () => {
    const interceptor = createEventDedupInterceptor({ maxCacheSize: 2 });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    const make = (id: string): AgentInput => ({
      message: 'hi',
      conversationId: 'c1',
      context: { eventId: id },
    });

    // Fill cache to capacity with a and b, then c should evict a.
    await executeChain(chain, make('a'));
    await executeChain(chain, make('b'));
    await executeChain(chain, make('c')); // evicts 'a', cache now {b, c}

    // b and c are cached → duplicates should skip
    const reB = await executeChain(chain, make('b'));
    const reC = await executeChain(chain, make('c'));
    expect(reB).toBeNull();
    expect(reC).toBeNull();

    // a was evicted → should be allowed through as fresh
    const reA = await executeChain(chain, make('a'));
    expect(reA).not.toBeNull();
  });

  it('supports custom getEventId', async () => {
    const interceptor = createEventDedupInterceptor({
      getEventId: (input) => input.message,
    });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    const r1 = await executeChain(chain, { message: 'hello', conversationId: 'c1' });
    const r2 = await executeChain(chain, { message: 'hello', conversationId: 'c1' });

    expect(r1).not.toBeNull();
    expect(r2).toBeNull();
  });
});

// ---------- noise-filter ----------

describe('createNoiseFilterInterceptor', () => {
  it('drops messages with denied subtype', async () => {
    const onFiltered = vi.fn();
    const interceptor = createNoiseFilterInterceptor({
      denySubtypes: ['message_changed', 'bot_message'],
      onFiltered,
    });

    const input: AgentInput = {
      message: 'edited',
      conversationId: 'c1',
      context: { subtype: 'message_changed' },
    };
    const { result, agent } = await runInterceptor(interceptor, input);

    expect(result).toBeNull();
    expect(agent.invokeAgent).not.toHaveBeenCalled();
    expect(onFiltered).toHaveBeenCalledWith('message_changed', input);
  });

  it('passes through messages without denied subtype', async () => {
    const interceptor = createNoiseFilterInterceptor({
      denySubtypes: ['message_changed'],
    });
    const input: AgentInput = {
      message: 'hi',
      conversationId: 'c1',
      context: { subtype: 'regular' },
    };
    const { result, agent } = await runInterceptor(interceptor, input);

    expect(result).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
  });

  it('passes through when subtype is missing', async () => {
    const interceptor = createNoiseFilterInterceptor({ denySubtypes: ['x'] });
    const { result, agent } = await runInterceptor(interceptor, {
      message: 'hi',
      conversationId: 'c1',
    });
    expect(result).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
  });

  it('supports custom getSubtype', async () => {
    const interceptor = createNoiseFilterInterceptor({
      denySubtypes: ['noisy'],
      getSubtype: (input) => input.intent,
    });
    const { result } = await runInterceptor(interceptor, {
      message: 'hi',
      conversationId: 'c1',
      intent: 'noisy',
    });
    expect(result).toBeNull();
  });
});

// ---------- self-filter ----------

describe('createSelfFilterInterceptor', () => {
  it('drops messages where sender is agent itself (via agentId config)', async () => {
    const onSelfMessage = vi.fn();
    const interceptor = createSelfFilterInterceptor({
      agentId: 'U0123456',
      getSenderId: (input) => input.context?.senderId as string | undefined,
      onSelfMessage,
    });
    const input: AgentInput = {
      message: 'loop?',
      conversationId: 'c1',
      context: { senderId: 'U0123456' },
    };
    const { result, agent } = await runInterceptor(interceptor, input);

    expect(result).toBeNull();
    expect(agent.invokeAgent).not.toHaveBeenCalled();
    expect(onSelfMessage).toHaveBeenCalledWith('U0123456', input);
  });

  it('falls back to agent name when agentId not provided', async () => {
    const interceptor = createSelfFilterInterceptor({
      getSenderId: (input) => input.context?.senderId as string | undefined,
    });
    const agent = createMockAgent('my-bot');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());
    const input: AgentInput = {
      message: 'loop?',
      conversationId: 'c1',
      context: { senderId: 'my-bot' },
    };
    const result = await executeChain(chain, input);
    expect(result).toBeNull();
  });

  it('passes through messages from other senders', async () => {
    const interceptor = createSelfFilterInterceptor({
      agentId: 'U0123456',
      getSenderId: (input) => input.context?.senderId as string | undefined,
    });
    const { result, agent } = await runInterceptor(interceptor, {
      message: 'hi',
      conversationId: 'c1',
      context: { senderId: 'U9999999' },
    });

    expect(result).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
  });

  it('passes through when sender ID is missing', async () => {
    const interceptor = createSelfFilterInterceptor({
      agentId: 'U0123456',
      getSenderId: () => undefined,
    });
    const { result } = await runInterceptor(interceptor, { message: 'hi', conversationId: 'c1' });
    expect(result).not.toBeNull();
  });
});

// ---------- rate-limit ----------

describe('createRateLimitInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the token limit', async () => {
    const interceptor = createRateLimitInterceptor({
      getKey: () => 'user-1',
      tokensPerInterval: 3,
      interval: 60000,
    });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    const input: AgentInput = { message: 'hi', conversationId: 'c1' };

    const r1 = await executeChain(chain, input);
    const r2 = await executeChain(chain, input);
    const r3 = await executeChain(chain, input);

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(3);
  });

  it('skips requests after tokens exhausted (onExceeded=skip)', async () => {
    const onRateLimited = vi.fn();
    const interceptor = createRateLimitInterceptor({
      getKey: () => 'user-1',
      tokensPerInterval: 2,
      interval: 60000,
      onExceeded: 'skip',
      onRateLimited,
    });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    await executeChain(chain, { message: 'a', conversationId: 'c1' });
    await executeChain(chain, { message: 'b', conversationId: 'c1' });
    const r3 = await executeChain(chain, { message: 'c', conversationId: 'c1' });

    expect(r3).toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(2);
    expect(onRateLimited).toHaveBeenCalledTimes(1);
    expect(onRateLimited.mock.calls[0][0]).toBe('user-1');
  });

  it('throws when exceeded (onExceeded=reject)', async () => {
    const interceptor = createRateLimitInterceptor({
      getKey: () => 'user-1',
      tokensPerInterval: 1,
      interval: 60000,
      onExceeded: 'reject',
    });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    await executeChain(chain, { message: 'a', conversationId: 'c1' });
    await expect(
      executeChain(chain, { message: 'b', conversationId: 'c1' })
    ).rejects.toThrow(/rate limit/i);
  });

  it('refills tokens after interval elapses', async () => {
    const interceptor = createRateLimitInterceptor({
      getKey: () => 'user-1',
      tokensPerInterval: 2,
      interval: 60000,
    });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    await executeChain(chain, { message: 'a', conversationId: 'c1' });
    await executeChain(chain, { message: 'b', conversationId: 'c1' });
    const exhausted = await executeChain(chain, { message: 'c', conversationId: 'c1' });
    expect(exhausted).toBeNull();

    // Advance time by one full interval so the bucket refills.
    vi.advanceTimersByTime(60000);

    const afterRefill = await executeChain(chain, { message: 'd', conversationId: 'c1' });
    expect(afterRefill).not.toBeNull();
  });

  it('tracks separate buckets per key', async () => {
    const interceptor = createRateLimitInterceptor({
      getKey: (input) => input.context?.userId as string,
      tokensPerInterval: 1,
      interval: 60000,
    });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    const u1 = await executeChain(chain, {
      message: 'hi',
      conversationId: 'c1',
      context: { userId: 'u1' },
    });
    const u2 = await executeChain(chain, {
      message: 'hi',
      conversationId: 'c1',
      context: { userId: 'u2' },
    });
    const u1Again = await executeChain(chain, {
      message: 'hi',
      conversationId: 'c1',
      context: { userId: 'u1' },
    });

    expect(u1).not.toBeNull();
    expect(u2).not.toBeNull();
    expect(u1Again).toBeNull(); // u1 bucket exhausted
  });

  it('respects maxBuckets via LRU eviction', async () => {
    // With maxBuckets=2, the third key should evict the least-recently-used bucket.
    const interceptor = createRateLimitInterceptor({
      getKey: (input) => input.context?.userId as string,
      tokensPerInterval: 1,
      interval: 60000,
      maxBuckets: 2,
    });
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor], agent, createMockChannel(), createMockRegistry());

    const call = (userId: string) =>
      executeChain(chain, {
        message: 'hi',
        conversationId: 'c1',
        context: { userId },
      });

    await call('u1'); // u1 bucket created, 1 token consumed
    await call('u2'); // u2 bucket created
    // u1 exhausted locally: second call should skip
    const u1Second = await call('u1');
    expect(u1Second).toBeNull();

    // Now add u3. This evicts the LRU bucket. 'u1' was used most recently (via u1Second).
    // So u2 should be evicted.
    await call('u3');

    // u2 was evicted, so its next request gets a fresh bucket and succeeds.
    const u2Fresh = await call('u2');
    expect(u2Fresh).not.toBeNull();
  });
});

// ---------- participant-resolver ----------

describe('createParticipantResolverInterceptor', () => {
  /** Capture the input that reaches downstream for assertions. */
  function captureDownstream() {
    let captured: AgentInput | undefined;
    const downstream: Interceptor = async (input, _ctx, next) => {
      captured = input;
      return await next();
    };
    return { downstream, get: () => captured };
  }

  it('enriches input with first-class participant field when explicit resolver returns one', async () => {
    const onResolved = vi.fn();
    const participant = { kind: 'user' as const, id: 'u1', displayName: 'Alice' };

    const interceptor = createParticipantResolverInterceptor({
      resolveParticipant: () => participant,
      onResolved,
    });

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor, downstream], agent, createMockChannel(), createMockRegistry());
    await executeChain(chain, { message: 'hi', conversationId: 'c1' });

    expect(get()?.participant).toEqual(participant);
    // Legacy context slot is also populated for back-compat
    expect(get()?.context?._participant).toEqual(participant);
    expect(onResolved).toHaveBeenCalled();
  });

  it('awaits async explicit resolver', async () => {
    const participant = { kind: 'user' as const, id: 'u2', displayName: 'Bob' };
    const interceptor = createParticipantResolverInterceptor({
      resolveParticipant: async () => participant,
    });

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor, downstream], agent, createMockChannel(), createMockRegistry());
    await executeChain(chain, { message: 'hi', conversationId: 'c1' });

    expect(get()?.participant).toEqual(participant);
  });

  it("falls back to ctx.channel.resolveParticipant when no explicit resolver is provided", async () => {
    const resolved = { kind: 'user' as const, id: 'u3', displayName: 'Carol' };
    const interceptor = createParticipantResolverInterceptor(); // no config

    const channel = createMockChannel();
    channel.resolveParticipant = vi.fn().mockResolvedValue(resolved);

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor, downstream], agent, channel, createMockRegistry());
    await executeChain(chain, { message: 'hi', conversationId: 'c1' });

    expect(channel.resolveParticipant).toHaveBeenCalled();
    expect(get()?.participant).toEqual(resolved);
  });

  it("explicit resolver takes precedence over channel.resolveParticipant", async () => {
    const channelResolved = { kind: 'user' as const, id: 'channel-id', displayName: 'FromChannel' };
    const explicitResolved = { kind: 'user' as const, id: 'explicit-id', displayName: 'FromConfig' };

    const channel = createMockChannel();
    channel.resolveParticipant = vi.fn().mockResolvedValue(channelResolved);

    const interceptor = createParticipantResolverInterceptor({
      resolveParticipant: () => explicitResolved,
    });

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor, downstream], agent, channel, createMockRegistry());
    await executeChain(chain, { message: 'hi', conversationId: 'c1' });

    expect(channel.resolveParticipant).not.toHaveBeenCalled();
    expect(get()?.participant).toEqual(explicitResolved);
  });

  it('preserves existing input.participant from normalize() when no resolver available', async () => {
    const fromNormalize = { kind: 'user' as const, id: 'u-norm' };
    const interceptor = createParticipantResolverInterceptor(); // no config

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    // Channel has no resolveParticipant hook
    const chain = composeChain([interceptor, downstream], agent, createMockChannel(), createMockRegistry());
    await executeChain(chain, {
      message: 'hi',
      conversationId: 'c1',
      participant: fromNormalize,
    });

    expect(get()?.participant).toEqual(fromNormalize);
    expect(get()?.context?._participant).toEqual(fromNormalize);
  });

  it('channel-resolved participant overrides normalize-provided participant', async () => {
    const fromNormalize = { kind: 'user' as const, id: 'u-norm' };
    const fromChannel = { kind: 'user' as const, id: 'u-norm', displayName: 'Resolved Name' };

    const channel = createMockChannel();
    channel.resolveParticipant = vi.fn().mockResolvedValue(fromChannel);

    const interceptor = createParticipantResolverInterceptor();

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor, downstream], agent, channel, createMockRegistry());
    await executeChain(chain, {
      message: 'hi',
      conversationId: 'c1',
      participant: fromNormalize,
    });

    expect(get()?.participant).toEqual(fromChannel);
  });

  it('falls back to normalize-provided participant when channel resolver throws', async () => {
    const fromNormalize = { kind: 'user' as const, id: 'u-norm' };
    const channel = createMockChannel();
    channel.resolveParticipant = vi.fn().mockRejectedValue(new Error('api down'));

    const interceptor = createParticipantResolverInterceptor();

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor, downstream], agent, channel, createMockRegistry());
    await executeChain(chain, {
      message: 'hi',
      conversationId: 'c1',
      participant: fromNormalize,
    });

    expect(get()?.participant).toEqual(fromNormalize);
  });

  it('passes through unchanged when nothing is available', async () => {
    const interceptor = createParticipantResolverInterceptor({
      resolveParticipant: () => undefined,
    });

    const { downstream, get } = captureDownstream();
    const agent = createMockAgent('test-agent');
    const chain = composeChain([interceptor, downstream], agent, createMockChannel(), createMockRegistry());
    await executeChain(chain, { message: 'hi', conversationId: 'c1' });

    expect(get()?.participant).toBeUndefined();
    expect(get()?.context?._participant).toBeUndefined();
  });
});

// ---------- address-check ----------

describe('isAgentNameOnlyInCodeBlocks', () => {
  it('returns false when name is not in message at all', () => {
    expect(isAgentNameOnlyInCodeBlocks('hello world', 'kael')).toBe(false);
  });

  it('returns false when there are no code regions', () => {
    expect(isAgentNameOnlyInCodeBlocks('hey kael, how are you?', 'kael')).toBe(false);
  });

  it('returns true when name is only inside a fenced block', () => {
    expect(isAgentNameOnlyInCodeBlocks('check this: ```error in kael system```', 'kael')).toBe(true);
  });

  it('returns false when name appears both inside and outside code', () => {
    expect(
      isAgentNameOnlyInCodeBlocks('hey kael, here is the issue: ```kael crashed```', 'kael')
    ).toBe(false);
  });

  it('returns true with multiple fenced blocks, name only inside', () => {
    const message = 'look: ```kael log 1``` also ```kael log 2``` please';
    expect(isAgentNameOnlyInCodeBlocks(message, 'kael')).toBe(true);
  });

  it('handles duplicate identical fenced blocks correctly', () => {
    const message = '```kael``` and again ```kael```';
    expect(isAgentNameOnlyInCodeBlocks(message, 'kael')).toBe(true);
  });

  it('treats inline backticks as code', () => {
    expect(isAgentNameOnlyInCodeBlocks('check `kael` output', 'kael')).toBe(true);
  });

  it('returns false when inline code contains name but name also outside', () => {
    expect(isAgentNameOnlyInCodeBlocks('hey kael, see `kael` in logs', 'kael')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isAgentNameOnlyInCodeBlocks('```KAEL output```', 'kael')).toBe(true);
  });
});

describe('createAddressCheckInterceptor', () => {
  const baseConfig = {
    agentName: 'kael',
    agentId: 'U123',
    getMessageText: (input: AgentInput) => input.message,
  };

  async function classify(input: AgentInput, extraConfig: Partial<typeof baseConfig> = {}) {
    let captured: AddressCheckResult | undefined;
    const interceptor = createAddressCheckInterceptor({
      ...baseConfig,
      ...extraConfig,
      onClassified: (result) => {
        captured = result;
      },
    });
    await runInterceptor(interceptor, input);
    return captured;
  }

  it('classifies DM as direct', async () => {
    const result = await classify(
      { message: 'hello', conversationId: 'c1' },
      { isDirectMessage: () => true } as Partial<typeof baseConfig> & { isDirectMessage: (i: AgentInput) => boolean }
    );
    expect(result).toBe('direct');
  });

  it('classifies vocative (greeting start) as direct', async () => {
    expect(await classify({ message: 'hey kael, help me', conversationId: 'c1' })).toBe('direct');
    expect(await classify({ message: '@kael fix this', conversationId: 'c1' })).toBe('direct');
    expect(await classify({ message: 'kael, do it', conversationId: 'c1' })).toBe('direct');
  });

  it('classifies possessive patterns as ambiguous (not direct)', async () => {
    expect(await classify({ message: 'the kael mentioned earlier', conversationId: 'c1' })).toBe('ambiguous');
    expect(await classify({ message: 'our kael logged that', conversationId: 'c1' })).toBe('ambiguous');
    expect(await classify({ message: 'my kael is broken', conversationId: 'c1' })).toBe('ambiguous');
  });

  it('classifies agent name only inside code block as ignore', async () => {
    expect(
      await classify({ message: 'see this: ```error in kael system```', conversationId: 'c1' })
    ).toBe('ignore');
  });

  it('does NOT classify as ignore when name is addressed outside code', async () => {
    // "hey kael" at the start is vocative → direct, regardless of code block below
    expect(
      await classify({ message: 'hey kael, here is: ```stack trace```', conversationId: 'c1' })
    ).toBe('direct');
  });

  it('classifies URL-only messages as ignore', async () => {
    expect(await classify({ message: 'https://example.com/doc', conversationId: 'c1' })).toBe('ignore');
  });

  it('classifies simple name mention as ambiguous', async () => {
    expect(await classify({ message: 'I was thinking about kael yesterday', conversationId: 'c1' })).toBe('ambiguous');
  });

  it('classifies no-mention as passive', async () => {
    expect(await classify({ message: 'just some chatter here', conversationId: 'c1' })).toBe('passive');
  });

  it('classifies co-mentions as indirect', async () => {
    // Message must not start with agent name (would match vocative rule as 'direct').
    const result = await classify(
      { message: 'please loop in kael and bob on this', conversationId: 'c1' },
      { getMentions: () => ['kael', 'bob'] } as Partial<typeof baseConfig> & { getMentions: (i: AgentInput) => string[] }
    );
    expect(result).toBe('indirect');
  });

  it('enriches input context with _addressCheck', async () => {
    const interceptor = createAddressCheckInterceptor(baseConfig);

    let capturedInput: AgentInput | undefined;
    const downstream: Interceptor = async (input, _ctx, next) => {
      capturedInput = input;
      return await next();
    };

    const agent = createMockAgent('kael');
    const chain = composeChain([interceptor, downstream], agent, createMockChannel(), createMockRegistry());
    await executeChain(chain, { message: 'hey kael', conversationId: 'c1' });

    expect(capturedInput?.context?._addressCheck).toBe('direct');
  });
});

// ---------- depth-guard ----------

describe('createDepthGuardInterceptor', () => {
  it('allows invocations at or below maxDepth', async () => {
    const interceptor = createDepthGuardInterceptor({ maxDepth: 5 });
    const { result, agent } = await runInterceptor(interceptor, {
      message: 'hi',
      conversationId: 'c1',
    });
    expect(result).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
  });

  it('DepthExceededError carries current and max depth', () => {
    const err = new DepthExceededError(7, 5);
    expect(err.currentDepth).toBe(7);
    expect(err.maxDepth).toBe(5);
    expect(err.name).toBe('DepthExceededError');
    expect(err.message).toContain('7');
    expect(err.message).toContain('5');
  });
});

// ---------- tracer ----------

describe('createTracerInterceptor', () => {
  it('forwards input to next and preserves result', async () => {
    const interceptor = createTracerInterceptor();
    const { result, agent } = await runInterceptor(interceptor, {
      message: 'hi',
      conversationId: 'c1',
    });
    expect(result).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
  });

  it('propagates skip sentinel from downstream', async () => {
    const tracer = createTracerInterceptor();
    const skipper: Interceptor = async (_input, ctx, _next) => ctx.skip();

    const agent = createMockAgent('test-agent');
    const chain = composeChain([tracer, skipper], agent, createMockChannel(), createMockRegistry());
    const result = await executeChain(chain, { message: 'hi', conversationId: 'c1' });

    expect(result).toBeNull();
    expect(agent.invokeAgent).not.toHaveBeenCalled();
  });

  it('re-throws errors from downstream after logging', async () => {
    const tracer = createTracerInterceptor();
    const thrower: Interceptor = async () => {
      throw new Error('boom');
    };

    const agent = createMockAgent('test-agent');
    const chain = composeChain([tracer, thrower], agent, createMockChannel(), createMockRegistry());

    await expect(
      executeChain(chain, { message: 'hi', conversationId: 'c1' })
    ).rejects.toThrow('boom');
  });

  it('skips tracing when shouldTrace returns false', async () => {
    const shouldTrace = vi.fn(() => false);
    const tracer = createTracerInterceptor({ shouldTrace });
    const { result, agent } = await runInterceptor(tracer, {
      message: 'hi',
      conversationId: 'c1',
    });
    expect(shouldTrace).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
  });
});

// ---------- intent-classifier ----------

describe('createIntentClassifierInterceptor', () => {
  const baseConfig = {
    agentName: 'kael',
    agentId: 'U123',
    getMessageText: (input: AgentInput) => input.message,
    getSenderName: () => 'alice',
    getChannelName: () => 'general',
  };

  /** Build a chain with the classifier interceptor and a registry containing a mock classifier agent. */
  function setup(
    classifierResult: AgentResult,
    configOverrides: Partial<Parameters<typeof createIntentClassifierInterceptor>[0]> = {},
    classifierName = 'intent-classifier'
  ) {
    const classifierAgent = createMockAgent(classifierName, classifierResult);
    const agents = new Map<string, AgentInstance>([[classifierName, classifierAgent]]);

    const interceptor = createIntentClassifierInterceptor({ ...baseConfig, ...configOverrides });
    const agent = createMockAgent('kael');
    const channel = createMockChannel();
    const registry = createMockRegistry(agents);
    const chain = composeChain([interceptor], agent, channel, registry);

    return { chain, agent, classifierAgent, registry };
  }

  it('short-circuits when address-check is direct (no LLM call)', async () => {
    const { chain, agent, classifierAgent } = setup({ output: 'direct' });
    const result = await executeChain(chain, {
      message: 'hello',
      conversationId: 'c1',
      context: { _addressCheck: 'direct' },
    });

    expect(result).not.toBeNull();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(classifierAgent.invokeAgent).not.toHaveBeenCalled();
  });

  it('short-circuits with skip when address-check is passive (no LLM call)', async () => {
    const onClassified = vi.fn();
    const { chain, agent, classifierAgent } = setup({ output: 'direct' }, { onClassified });
    const result = await executeChain(chain, {
      message: 'just chatter',
      conversationId: 'c1',
      context: { _addressCheck: 'passive' },
    });

    expect(result).toBeNull();
    expect(agent.invokeAgent).not.toHaveBeenCalled();
    expect(classifierAgent.invokeAgent).not.toHaveBeenCalled();
    expect(onClassified).toHaveBeenCalledWith('passive', expect.anything());
  });

  it('short-circuits with skip when address-check is ignore (no LLM call)', async () => {
    const onClassified = vi.fn();
    const { chain, agent, classifierAgent } = setup({ output: 'direct' }, { onClassified });
    const result = await executeChain(chain, {
      message: 'https://example.com',
      conversationId: 'c1',
      context: { _addressCheck: 'ignore' },
    });

    expect(result).toBeNull();
    expect(agent.invokeAgent).not.toHaveBeenCalled();
    expect(classifierAgent.invokeAgent).not.toHaveBeenCalled();
    expect(onClassified).toHaveBeenCalledWith('ignore', expect.anything());
  });

  it('delegates to classifier and continues when classification=direct', async () => {
    const onClassified = vi.fn();
    const { chain, agent, classifierAgent } = setup({ output: 'direct' }, { onClassified });
    const result = await executeChain(chain, {
      message: 'the kael issue',
      conversationId: 'c1',
      context: { _addressCheck: 'ambiguous' },
    });

    expect(classifierAgent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(onClassified).toHaveBeenCalledWith('direct', expect.anything());
  });

  it('delegates to classifier and skips when classification=passive', async () => {
    const { chain, agent, classifierAgent } = setup({ output: 'passive' });
    const result = await executeChain(chain, {
      message: 'the kael issue',
      conversationId: 'c1',
      context: { _addressCheck: 'ambiguous' },
    });

    expect(classifierAgent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(agent.invokeAgent).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('delegates to classifier and skips when classification=ignore', async () => {
    const { chain, agent } = setup({ output: 'ignore' });
    const result = await executeChain(chain, {
      message: 'the kael issue',
      conversationId: 'c1',
      context: { _addressCheck: 'indirect' },
    });
    expect(agent.invokeAgent).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('delegates to classifier and skips when classification=indirect', async () => {
    const { chain, agent } = setup({ output: 'indirect' });
    const result = await executeChain(chain, {
      message: 'the kael issue',
      conversationId: 'c1',
      context: { _addressCheck: 'ambiguous' },
    });
    expect(agent.invokeAgent).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('enriches input with _intentClassification before calling agent', async () => {
    const classifierAgent = createMockAgent('intent-classifier', { output: 'direct' });
    const agents = new Map<string, AgentInstance>([['intent-classifier', classifierAgent]]);

    const interceptor = createIntentClassifierInterceptor(baseConfig);
    const agent = createMockAgent('kael');
    const registry = createMockRegistry(agents);
    const chain = composeChain([interceptor], agent, createMockChannel(), registry);

    await executeChain(chain, {
      message: 'the kael issue',
      conversationId: 'c1',
      context: { _addressCheck: 'ambiguous' },
    });

    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
    const forwarded = (agent.invokeAgent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentInput;
    expect(forwarded.context?._intentClassification).toBe('direct');
    // Original address-check context is preserved too
    expect(forwarded.context?._addressCheck).toBe('ambiguous');
  });

  it('falls back to allowing the message when classifier throws', async () => {
    const brokenClassifier = createMockAgent('intent-classifier');
    (brokenClassifier.invokeAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('llm down'));
    const agents = new Map<string, AgentInstance>([['intent-classifier', brokenClassifier]]);

    const interceptor = createIntentClassifierInterceptor(baseConfig);
    const agent = createMockAgent('kael');
    const registry = createMockRegistry(agents);
    const chain = composeChain([interceptor], agent, createMockChannel(), registry);

    const result = await executeChain(chain, {
      message: 'the kael issue',
      conversationId: 'c1',
      context: { _addressCheck: 'ambiguous' },
    });

    expect(brokenClassifier.invokeAgent).toHaveBeenCalledTimes(1);
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it('skips empty-message classification and passes through', async () => {
    const { chain, agent, classifierAgent } = setup({ output: 'direct' });
    const result = await executeChain(chain, {
      message: '   ',
      conversationId: 'c1',
      context: { _addressCheck: 'ambiguous' },
    });
    // Empty text path does NOT delegate, just calls next
    expect(classifierAgent.invokeAgent).not.toHaveBeenCalled();
    expect(agent.invokeAgent).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it('uses custom classifierAgentName when provided', async () => {
    const custom = createMockAgent('my-classifier', { output: 'direct' });
    const agents = new Map<string, AgentInstance>([['my-classifier', custom]]);

    const interceptor = createIntentClassifierInterceptor({
      ...baseConfig,
      classifierAgentName: 'my-classifier',
    });
    const agent = createMockAgent('kael');
    const registry = createMockRegistry(agents);
    const chain = composeChain([interceptor], agent, createMockChannel(), registry);

    await executeChain(chain, {
      message: 'the kael issue',
      conversationId: 'c1',
      context: { _addressCheck: 'ambiguous' },
    });

    expect(custom.invokeAgent).toHaveBeenCalledTimes(1);
  });

  it('passes message text, agent identity and sender/channel context to classifier', async () => {
    const classifierAgent = createMockAgent('intent-classifier', { output: 'direct' });
    const agents = new Map<string, AgentInstance>([['intent-classifier', classifierAgent]]);

    const interceptor = createIntentClassifierInterceptor({
      ...baseConfig,
      isDirectMessage: () => false,
    });
    const agent = createMockAgent('kael');
    const registry = createMockRegistry(agents);
    const chain = composeChain([interceptor], agent, createMockChannel(), registry);

    await executeChain(chain, {
      message: 'hello kael team',
      conversationId: 'conv-xyz',
      context: { _addressCheck: 'ambiguous' },
    });

    const delegated = (classifierAgent.invokeAgent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentInput;
    expect(delegated.conversationId).toBe('conv-xyz');
    expect(delegated.data).toMatchObject({
      message: 'hello kael team',
      agentName: 'kael',
      agentId: 'U123',
      senderName: 'alice',
      channelName: 'general',
      isDirectMessage: false,
    });
  });
});

// ---------- regex-escape regression for address-check ----------

describe('createAddressCheckInterceptor - regex escaping', () => {
  async function classify(agentName: string, message: string) {
    let captured: AddressCheckResult | undefined;
    const interceptor = createAddressCheckInterceptor({
      agentName,
      agentId: 'U123',
      getMessageText: (input) => input.message,
      onClassified: (r) => {
        captured = r;
      },
    });
    await runInterceptor(interceptor, { message, conversationId: 'c1' });
    return captured;
  }

  it('handles agent name with dot ("agent.v2") without throwing', async () => {
    expect(await classify('agent.v2', 'hey agent.v2, help')).toBe('direct');
    // Dot should not match arbitrary char: "agentXv2" must not classify as direct
    expect(await classify('agent.v2', 'hey agentXv2 how are you')).not.toBe('direct');
  });

  it('does not treat "+" as regex quantifier for name "c++"', async () => {
    // Without escaping, "c++" would be a regex meaning one+ 'c's. With escaping,
    // the literal "ccc" must NOT match the literal name "c++".
    expect(await classify('c++', 'hey ccc please')).not.toBe('direct');
  });

  it('does not throw when agent name contains parentheses ("bot(dev)")', async () => {
    // Unescaped, "bot(dev)" creates an invalid/misinterpreted capture group.
    // We only assert construction + execution doesn't crash here.
    await expect(classify('bot(dev)', 'unrelated message')).resolves.toBeDefined();
    await expect(classify('bot(dev)', 'the bot(dev) said hello')).resolves.toBeDefined();
  });

  it('handles possessive pattern with special chars in name', async () => {
    expect(await classify('agent.v2', 'the agent.v2 logged an issue')).toBe('ambiguous');
  });

  it('does not throw when agentId contains regex metacharacters', async () => {
    const interceptor = createAddressCheckInterceptor({
      agentName: 'kael',
      agentId: 'U+special.id',
      getMessageText: (input) => input.message,
    });
    // Should not throw during RegExp construction
    const { result } = await runInterceptor(interceptor, {
      message: '@U+special.id help',
      conversationId: 'c1',
    });
    expect(result).not.toBeNull();
  });
});

// ---------- sanity: SKIP_SENTINEL helpers cross-check ----------

describe('skip sentinel integration', () => {
  it('isSkipSentinel identifies the skip symbol', () => {
    expect(isSkipSentinel(SKIP_SENTINEL)).toBe(true);
    expect(isSkipSentinel({ output: 'x' })).toBe(false);
  });
});
