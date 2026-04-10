import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseAgent } from './base-agent.js';
import { AgentInput, AgentResult } from './types.js';
import type { Toolpack } from 'toolpack-sdk';

// Mock Toolpack
const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Mock AI response',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    setMode: vi.fn(),
  } as unknown as Toolpack;
};

// Test agent implementation
class TestAgent extends BaseAgent<'greet' | 'help'> {
  name = 'test-agent';
  description = 'A test agent for unit testing';
  mode = 'chat';
  provider = 'openai';
  model = 'gpt-4';

  beforeRunCalled = false;
  completeCalled = false;
  errorCalled = false;
  stepCompleteCalled = false;

  async invokeAgent(input: AgentInput<'greet' | 'help'>): Promise<AgentResult> {
    if (input.intent === 'greet') {
      return { output: 'Hello!' };
    }
    return this.run(input.message || '');
  }

  async onBeforeRun(): Promise<void> {
    this.beforeRunCalled = true;
  }

  async onComplete(): Promise<void> {
    this.completeCalled = true;
  }

  async onError(): Promise<void> {
    this.errorCalled = true;
  }

  async onStepComplete(): Promise<void> {
    this.stepCompleteCalled = true;
  }
}

describe('BaseAgent', () => {
  let mockToolpack: Toolpack;

  beforeEach(() => {
    mockToolpack = createMockToolpack();
  });

  describe('properties', () => {
    it('should have required abstract properties', () => {
      const agent = new TestAgent(mockToolpack);

      expect(agent.name).toBe('test-agent');
      expect(agent.description).toBe('A test agent for unit testing');
      expect(agent.mode).toBe('chat');
    });

    it('should have optional identity properties', () => {
      const agent = new TestAgent(mockToolpack);

      expect(agent.provider).toBe('openai');
      expect(agent.model).toBe('gpt-4');
    });

    it('should have registry reference (set by AgentRegistry)', () => {
      const agent = new TestAgent(mockToolpack);
      expect(agent._registry).toBeUndefined();

      const mockRegistry = { sendTo: vi.fn() };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      expect(agent._registry).toBe(mockRegistry);
    });

    it('should have triggering channel reference', () => {
      const agent = new TestAgent(mockToolpack);
      expect(agent._triggeringChannel).toBeUndefined();

      agent._triggeringChannel = 'slack-support';
      expect(agent._triggeringChannel).toBe('slack-support');
    });
  });

  describe('invokeAgent', () => {
    it('should handle greet intent directly', async () => {
      const agent = new TestAgent(mockToolpack);
      const result = await agent.invokeAgent({
        intent: 'greet',
        message: 'Say hello',
        conversationId: 'test-1',
      });

      expect(result.output).toBe('Hello!');
    });

    it('should use run() for help intent', async () => {
      const agent = new TestAgent(mockToolpack);
      const result = await agent.invokeAgent({
        intent: 'help',
        message: 'I need help',
        conversationId: 'test-2',
      });

      expect(result.output).toBe('Mock AI response');
      expect(mockToolpack.setMode).toHaveBeenCalledWith('chat');
    });
  });

  describe('run() execution engine', () => {
    it('should call setMode before generate', async () => {
      const agent = new TestAgent(mockToolpack);
      await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-3',
      });

      expect(mockToolpack.setMode).toHaveBeenCalledWith('chat');
      expect(mockToolpack.generate).toHaveBeenCalled();
    });

    it('should pass provider override to generate', async () => {
      const agent = new TestAgent(mockToolpack);
      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-4',
      });

      expect(mockToolpack.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Test' }],
          model: 'gpt-4',
        }),
        'openai'
      );
    });

    it('should return AgentResult with output and metadata', async () => {
      const agent = new TestAgent(mockToolpack);
      const result = await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-5',
      });

      expect(result.output).toBe('Mock AI response');
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.usage).toBeDefined();
    });

    it('should handle errors from generate', async () => {
      const errorToolpack = createMockToolpack();
      vi.mocked(errorToolpack.generate).mockRejectedValue(new Error('API Error'));

      const agent = new TestAgent(errorToolpack);

      await expect(agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-6',
      })).rejects.toThrow('API Error');
    });
  });

  describe('lifecycle hooks', () => {
    it('should call onBeforeRun before execution', async () => {
      const agent = new TestAgent(mockToolpack);
      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-7',
      });

      expect(agent.beforeRunCalled).toBe(true);
    });

    it('should call onComplete after successful execution', async () => {
      const agent = new TestAgent(mockToolpack);
      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-8',
      });

      expect(agent.completeCalled).toBe(true);
    });

    it('should call onError when execution fails', async () => {
      const errorToolpack = createMockToolpack();
      vi.mocked(errorToolpack.generate).mockRejectedValue(new Error('API Error'));

      const agent = new TestAgent(errorToolpack);

      try {
        await agent.invokeAgent({
          message: 'Test',
          conversationId: 'test-9',
        });
      } catch {
        // Expected
      }

      expect(agent.errorCalled).toBe(true);
    });
  });

  describe('events', () => {
    it('should emit agent:start event', async () => {
      const agent = new TestAgent(mockToolpack);
      const startHandler = vi.fn();
      agent.on('agent:start', startHandler);

      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-10',
      });

      expect(startHandler).toHaveBeenCalledWith({ message: 'Test' });
    });

    it('should emit agent:complete event', async () => {
      const agent = new TestAgent(mockToolpack);
      const completeHandler = vi.fn();
      agent.on('agent:complete', completeHandler);

      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-11',
      });

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          output: 'Mock AI response',
        })
      );
    });

    it('should emit agent:error event', async () => {
      const errorToolpack = createMockToolpack();
      vi.mocked(errorToolpack.generate).mockRejectedValue(new Error('API Error'));

      const agent = new TestAgent(errorToolpack);
      const errorHandler = vi.fn();
      agent.on('agent:error', errorHandler);

      try {
        await agent.invokeAgent({
          message: 'Test',
          conversationId: 'test-12',
        });
      } catch {
        // Expected
      }

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('sendTo', () => {
    it('should throw if registry not set', async () => {
      const agent = new TestAgent(mockToolpack);

      await expect(agent['sendTo']('some-channel', 'message')).rejects.toThrow(
        'Agent not registered - _registry not set'
      );
    });

    it('should call registry.sendTo when registry is set', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockSendTo = vi.fn().mockResolvedValue(undefined);
      agent._registry = { sendTo: mockSendTo } as unknown as import('./types.js').IAgentRegistry;

      await agent['sendTo']('slack-channel', 'Hello from agent');

      expect(mockSendTo).toHaveBeenCalledWith('slack-channel', {
        output: 'Hello from agent',
      });
    });
  });

  describe('ask', () => {
    it('should return __pending__ in Phase 1', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = {
        sendTo: vi.fn().mockResolvedValue(undefined),
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack-support';

      const result = await agent['ask']('What is your name?');

      expect(result).toBe('__pending__');
    });

    it('should send question to triggering channel', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockSendTo = vi.fn().mockResolvedValue(undefined);
      agent._registry = { sendTo: mockSendTo } as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack-support';

      await agent['ask']('What is your name?');

      expect(mockSendTo).toHaveBeenCalledWith('slack-support', { output: 'What is your name?' });
    });
  });

  describe('extractSteps', () => {
    it('should extract steps from plan in result', async () => {
      const planToolpack = createMockToolpack();
      vi.mocked(planToolpack.generate).mockResolvedValue({
        content: 'Response',
        plan: {
          steps: [
            {
              number: 1,
              description: 'Step 1',
              status: 'completed',
              result: { success: true },
            },
            {
              number: 2,
              description: 'Step 2',
              status: 'in_progress',
            },
          ],
        },
      } as unknown as import('toolpack-sdk').CompletionResponse);

      const agent = new TestAgent(planToolpack);
      const result = await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-13',
      });

      expect(result.steps).toHaveLength(2);
      expect(result.steps?.[0].number).toBe(1);
      expect(result.steps?.[0].status).toBe('completed');
      expect(result.steps?.[1].status).toBe('in_progress');
    });

    it('should handle results without steps', async () => {
      const agent = new TestAgent(mockToolpack);
      const result = await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-14',
      });

      expect(result.steps).toBeUndefined();
    });
  });
});
