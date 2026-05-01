import { describe, it, expect, vi } from 'vitest';
import type { AgentInput, AgentResult, AgentInstance, ChannelInterface } from '../agent/types.js';
import type { IAgentRegistry } from '../agent/types.js';
import {
  type Interceptor,
  type InterceptorContext,
  SKIP_SENTINEL,
  skip,
  isSkipSentinel,
} from './types.js';
import {
  composeChain,
  executeChain,
  InvocationDepthExceededError,
} from './chain.js';

// Mock agent
function createMockAgent(name: string, result: AgentResult): AgentInstance {
  return {
    name,
    description: `Mock ${name}`,
    mode: 'chat',
    invokeAgent: vi.fn().mockResolvedValue(result),
  } as unknown as AgentInstance;
}

// Mock channel
function createMockChannel(name: string): ChannelInterface {
  return {
    name,
    isTriggerChannel: false,
    listen: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    normalize: vi.fn(),
    onMessage: vi.fn(),
  };
}

// Mock registry
function createMockRegistry(agents: Map<string, AgentInstance>): IAgentRegistry {
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

describe('Interceptor Chain', () => {
  const baseInput: AgentInput = {
    message: 'Hello',
    conversationId: 'conv-1',
  };

  const baseResult: AgentResult = {
    output: 'Hi there!',
  };

  describe('composeChain', () => {
    it('invokes agent directly when no interceptors', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const chain = composeChain([], agent, channel, registry);
      const result = await chain.execute(baseInput);

      expect(agent.invokeAgent).toHaveBeenCalledWith(baseInput);
      expect(result).toEqual(baseResult);
    });

    it('executes single interceptor in order', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const order: string[] = [];

      const interceptor: Interceptor = async (input, ctx, next) => {
        order.push('interceptor-in');
        const result = await next();
        order.push('interceptor-out');
        return result;
      };

      const chain = composeChain([interceptor], agent, channel, registry);
      await chain.execute(baseInput);

      expect(order).toEqual(['interceptor-in', 'interceptor-out']);
    });

    it('executes multiple interceptors in correct order (outermost first)', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const order: string[] = [];

      const interceptor1: Interceptor = async (input, ctx, next) => {
        order.push('outer-in');
        const result = await next();
        order.push('outer-out');
        return result;
      };

      const interceptor2: Interceptor = async (input, ctx, next) => {
        order.push('inner-in');
        const result = await next();
        order.push('inner-out');
        return result;
      };

      const chain = composeChain([interceptor1, interceptor2], agent, channel, registry);
      await chain.execute(baseInput);

      // First interceptor is outermost: runs first in, last out
      expect(order).toEqual(['outer-in', 'inner-in', 'inner-out', 'outer-out']);
    });

    it('allows interceptor to short-circuit by not calling next', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const shortCircuitResult: AgentResult = {
        output: 'Short-circuited!',
        metadata: { shortCircuited: true },
      };

      const interceptor: Interceptor = async (input, ctx, next) => {
        // Don't call next - return early
        return shortCircuitResult;
      };

      const chain = composeChain([interceptor], agent, channel, registry);
      const result = await chain.execute(baseInput);

      expect(agent.invokeAgent).not.toHaveBeenCalled();
      expect(result).toEqual(shortCircuitResult);
    });

    it('provides correct context to interceptor', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      let capturedCtx: InterceptorContext | undefined;

      const interceptor: Interceptor = async (input, ctx, next) => {
        capturedCtx = ctx;
        return await next();
      };

      const chain = composeChain([interceptor], agent, channel, registry);
      await chain.execute(baseInput);

      expect(capturedCtx).toBeDefined();
      expect(capturedCtx!.agent).toBe(agent);
      expect(capturedCtx!.channel).toBe(channel);
      expect(capturedCtx!.registry).toBe(registry);
      expect(capturedCtx!.invocationDepth).toBe(0);
      expect(typeof capturedCtx!.delegateAndWait).toBe('function');
      expect(typeof capturedCtx!.skip).toBe('function');
    });

    it('initial invocation depth is 0 at top-level', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      let capturedDepth: number | undefined;

      const interceptor: Interceptor = async (input, ctx, next) => {
        capturedDepth = ctx.invocationDepth;
        return await next();
      };

      const chain = composeChain([interceptor], agent, channel, registry);
      await chain.execute(baseInput);

      // Top-level chain starts at depth 0
      expect(capturedDepth).toBe(0);
    });

    it('delegateAndWait increments depth for nested delegation', async () => {
      // This test verifies that when an interceptor at depth 0 calls delegateAndWait,
      // the delegated agent is invoked with the next depth level (1)
      const delegateResult: AgentResult = { output: 'Delegated!' };
      const delegateAgent = createMockAgent('delegate', delegateResult);
      const mainAgent = createMockAgent('main', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map([['delegate', delegateAgent]]));

      // Track the depth check in delegateAndWait
      let depthCheckPassed = false;

      const interceptor: Interceptor = async (input, ctx, next) => {
        // At depth 0, try to delegate - this should use depth 1 for the check
        if (ctx.invocationDepth === 0) {
          await ctx.delegateAndWait('delegate', { message: 'test' });
          depthCheckPassed = true;
        }
        return await next();
      };

      const chain = composeChain([interceptor], mainAgent, channel, registry, {
        maxInvocationDepth: 5, // Allow up to depth 5
      });

      await chain.execute(baseInput);

      // Delegation succeeded at depth 1 (0 + 1)
      expect(depthCheckPassed).toBe(true);
      expect(delegateAgent.invokeAgent).toHaveBeenCalled();
    });
  });

  describe('skip sentinel', () => {
    it('supports skip() helper from context', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const interceptor: Interceptor = async (input, ctx, next) => {
        return ctx.skip();
      };

      const chain = composeChain([interceptor], agent, channel, registry);
      const result = await chain.execute(baseInput);

      expect(result).toBe(SKIP_SENTINEL);
      expect(isSkipSentinel(result)).toBe(true);
      expect(agent.invokeAgent).not.toHaveBeenCalled();
    });

    it('skip() returns SKIP_SENTINEL symbol', () => {
      expect(skip()).toBe(SKIP_SENTINEL);
    });

    it('isSkipSentinel correctly identifies sentinel', () => {
      expect(isSkipSentinel(SKIP_SENTINEL)).toBe(true);
      expect(isSkipSentinel({ output: 'test' })).toBe(false);
      expect(isSkipSentinel(null as unknown as typeof SKIP_SENTINEL)).toBe(false);
      expect(isSkipSentinel(undefined as unknown as typeof SKIP_SENTINEL)).toBe(false);
    });
  });

  describe('executeChain helper', () => {
    it('returns AgentResult when not skipped', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const chain = composeChain([], agent, channel, registry);
      const result = await executeChain(chain, baseInput);

      expect(result).toEqual(baseResult);
    });

    it('returns null when skipped', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const interceptor: Interceptor = async (input, ctx, next) => {
        return ctx.skip();
      };

      const chain = composeChain([interceptor], agent, channel, registry);
      const result = await executeChain(chain, baseInput);

      expect(result).toBeNull();
    });
  });

  describe('delegation', () => {
    it('delegateAndWait invokes target agent', async () => {
      const delegateResult: AgentResult = { output: 'Delegated result!' };
      const delegateAgent = createMockAgent('delegate', delegateResult);
      const mainAgent = createMockAgent('main', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map([['delegate', delegateAgent]]));

      let delegatedResult: AgentResult | undefined;

      const interceptor: Interceptor = async (input, ctx, next) => {
        delegatedResult = await ctx.delegateAndWait('delegate', {
          message: 'Please help',
          data: { extra: 'context' },
        });
        return await next();
      };

      const chain = composeChain([interceptor], mainAgent, channel, registry);
      await chain.execute(baseInput);

      expect(delegateAgent.invokeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Please help',
          data: { extra: 'context' },
          // Inherits conversationId from original input (baseInput.conversationId = 'conv-1')
          conversationId: 'conv-1',
        })
      );
      expect(delegatedResult).toEqual(delegateResult);
    });

    it('throws when delegating to non-existent agent', async () => {
      const mainAgent = createMockAgent('main', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map()); // empty

      const interceptor: Interceptor = async (input, ctx, next) => {
        await ctx.delegateAndWait('nonexistent', { message: 'test' });
        return await next();
      };

      const chain = composeChain([interceptor], mainAgent, channel, registry);

      await expect(chain.execute(baseInput)).rejects.toThrow(
        'Agent "nonexistent" not found for delegation'
      );
    });

    it('throws InvocationDepthExceededError when past max depth', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      let error: Error | undefined;

      const interceptor: Interceptor = async (input, ctx, next) => {
        try {
          // Try to delegate at max depth
          await ctx.delegateAndWait('test', { message: 'test' });
        } catch (e) {
          error = e as Error;
        }
        return await next();
      };

      const chain = composeChain([interceptor], agent, channel, registry, {
        maxInvocationDepth: 0, // Zero tolerance
      });
      await chain.execute(baseInput);

      expect(error).toBeInstanceOf(InvocationDepthExceededError);
      // At depth 0, trying to delegate results in nextDepth=1, which exceeds maxDepth=0
      expect(error?.message).toContain('Invocation depth 1 exceeds maximum 0');
    });

    it('inherits conversationId from original input when delegating', async () => {
      const delegateResult: AgentResult = { output: 'Delegated!' };
      const delegateAgent = createMockAgent('delegate', delegateResult);
      const mainAgent = createMockAgent('main', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map([['delegate', delegateAgent]]));

      let delegatedInput: AgentInput | undefined;

      const interceptor: Interceptor = async (input, ctx, next) => {
        await ctx.delegateAndWait('delegate', { message: 'test' });
        return await next();
      };

      (delegateAgent.invokeAgent as ReturnType<typeof vi.fn>).mockImplementation((input: AgentInput) => {
        delegatedInput = input;
        return Promise.resolve(delegateResult);
      });

      const chain = composeChain([interceptor], mainAgent, channel, registry);
      await chain.execute({ ...baseInput, conversationId: 'original-conv-123' });

      // Delegated call should inherit conversationId from original execute input
      expect(delegatedInput?.conversationId).toBe('original-conv-123');
    });

    it('allows override of conversationId in delegation', async () => {
      const delegateResult: AgentResult = { output: 'Delegated!' };
      const delegateAgent = createMockAgent('delegate', delegateResult);
      const mainAgent = createMockAgent('main', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map([['delegate', delegateAgent]]));

      let delegatedInput: AgentInput | undefined;

      const interceptor: Interceptor = async (input, ctx, next) => {
        await ctx.delegateAndWait('delegate', {
          message: 'test',
          conversationId: 'custom-conv-456', // Explicitly set
        });
        return await next();
      };

      (delegateAgent.invokeAgent as ReturnType<typeof vi.fn>).mockImplementation((input: AgentInput) => {
        delegatedInput = input;
        return Promise.resolve(delegateResult);
      });

      const chain = composeChain([interceptor], mainAgent, channel, registry);
      await chain.execute({ ...baseInput, conversationId: 'original-conv-123' });

      // Delegated call should use the explicitly provided conversationId
      expect(delegatedInput?.conversationId).toBe('custom-conv-456');
    });
  });

  describe('error propagation', () => {
    it('propagates errors from interceptor', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const interceptor: Interceptor = async (input, ctx, next) => {
        throw new Error('Interceptor error!');
      };

      const chain = composeChain([interceptor], agent, channel, registry);

      await expect(chain.execute(baseInput)).rejects.toThrow('Interceptor error!');
    });

    it('propagates errors from agent', async () => {
      const agent = createMockAgent('test', baseResult);
      (agent.invokeAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Agent error!')
      );

      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const chain = composeChain([], agent, channel, registry);

      await expect(chain.execute(baseInput)).rejects.toThrow('Agent error!');
    });

    it('still runs post-processing when error occurs downstream', async () => {
      const agent = createMockAgent('test', baseResult);
      (agent.invokeAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Agent error!')
      );

      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const postProcessingRan: boolean[] = [];

      const interceptor: Interceptor = async (input, ctx, next) => {
        try {
          return await next();
        } catch {
          postProcessingRan.push(true);
          return { output: 'recovered' };
        }
      };

      const chain = composeChain([interceptor], agent, channel, registry);

      // The interceptor catches and recovers
      const result = await chain.execute(baseInput);

      expect(postProcessingRan).toContain(true);
      expect(result).toEqual({ output: 'recovered' });
    });
  });

  describe('interceptor can transform input', () => {
    it('allows interceptor to modify input before passing to next', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      let receivedInput: AgentInput | undefined;

      const innerInterceptor: Interceptor = async (input, ctx, next) => {
        receivedInput = input;
        return await next();
      };

      const outerInterceptor: Interceptor = async (input, ctx, next) => {
        const modifiedInput: AgentInput = {
          ...input,
          message: 'Modified: ' + input.message,
          context: { modified: true },
        };
        // Pass modified input downstream
        return await next(modifiedInput);
      };

      const chain = composeChain([outerInterceptor, innerInterceptor], agent, channel, registry);
      await chain.execute(baseInput);

      // The inner interceptor should receive the modified input
      expect(receivedInput?.message).toBe('Modified: Hello');
      expect(receivedInput?.context).toEqual({ modified: true });
    });

    it('uses original input when next() called without arguments', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      let receivedInput: AgentInput | undefined;

      const innerInterceptor: Interceptor = async (input, ctx, next) => {
        receivedInput = input;
        return await next();
      };

      const outerInterceptor: Interceptor = async (input, ctx, next) => {
        // Call next() without passing input - should use original
        return await next();
      };

      const chain = composeChain([outerInterceptor, innerInterceptor], agent, channel, registry);
      await chain.execute(baseInput);

      // The inner interceptor should receive the original input
      expect(receivedInput?.message).toBe('Hello');
    });
  });

  describe('interceptor can transform result', () => {
    it('allows interceptor to modify result on way out', async () => {
      const agent = createMockAgent('test', baseResult);
      const channel = createMockChannel('test-channel');
      const registry = createMockRegistry(new Map());

      const interceptor: Interceptor = async (input, ctx, next) => {
        const result = await next();
        if (!isSkipSentinel(result)) {
          return {
            ...result,
            metadata: { ...result.metadata, intercepted: true },
          };
        }
        return result;
      };

      const chain = composeChain([interceptor], agent, channel, registry);
      const result = await chain.execute(baseInput);

      expect(result).toEqual({
        output: 'Hi there!',
        metadata: { intercepted: true },
      });
    });
  });
});
