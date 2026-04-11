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
    it('should return AgentResult with waitingForHuman metadata', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = {
        sendTo: vi.fn().mockResolvedValue(undefined),
        addPendingAsk: vi.fn().mockReturnValue({
          id: 'test-conv:test-agent:1234567890',
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'What is your name?',
          context: {},
          maxRetries: 2,
          status: 'pending',
          retries: 0,
          askedAt: new Date(),
        }),
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack-support';
      agent._conversationId = 'test-conv';

      const result = await agent['ask']('What is your name?');

      expect(result.output).toBe('What is your name?');
      expect(result.metadata?.waitingForHuman).toBe(true);
      expect(result.metadata?.askId).toBeDefined();
    });

    it('should send question to triggering channel', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockSendTo = vi.fn().mockResolvedValue(undefined);
      const mockRegistry = {
        sendTo: mockSendTo,
        addPendingAsk: vi.fn().mockReturnValue({
          id: 'test-conv:test-agent:1234567890',
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'What is your name?',
          context: {},
          maxRetries: 2,
          status: 'pending',
          retries: 0,
          askedAt: new Date(),
        }),
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack-support';
      agent._conversationId = 'test-conv';

      await agent['ask']('What is your name?');

      expect(mockSendTo).toHaveBeenCalledWith('slack-support', { output: 'What is your name?' });
    });

    it('should throw if no registry is set', async () => {
      const agent = new TestAgent(mockToolpack);
      agent._triggeringChannel = 'slack-support';
      agent._conversationId = 'test-conv';

      await expect(agent['ask']('What is your name?')).rejects.toThrow(
        'Agent not registered - cannot use ask()'
      );
    });

    it('should throw if no conversationId is available', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = { sendTo: vi.fn() };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack-support';

      await expect(agent['ask']('What is your name?')).rejects.toThrow(
        'No conversationId available - ask() requires a conversation channel'
      );
    });

    it('should throw if called from a trigger channel (ScheduledChannel)', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = {
        sendTo: vi.fn().mockResolvedValue(undefined),
        addPendingAsk: vi.fn(),
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'daily-report';
      agent._conversationId = 'scheduled:test:2024-01-01';
      agent._isTriggerChannel = true; // This flag is set by AgentRegistry for ScheduledChannel

      await expect(agent['ask']('What is your name?')).rejects.toThrow(
        'this.ask() called from a trigger channel (ScheduledChannel)'
      );
    });

    it('should support custom context, maxRetries, and expiresIn options', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockAddPendingAsk = vi.fn().mockReturnValue({
        id: 'test-conv:test-agent:1234567890',
        conversationId: 'test-conv',
        agentName: 'test-agent',
        question: 'What is your name?',
        context: { step: 3, data: 'test' },
        maxRetries: 5,
        expiresAt: expect.any(Date),
        status: 'pending',
        retries: 0,
        askedAt: expect.any(Date),
      });
      const mockRegistry = {
        sendTo: vi.fn().mockResolvedValue(undefined),
        addPendingAsk: mockAddPendingAsk,
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack-support';
      agent._conversationId = 'test-conv';

      await agent['ask']('What is your name?', {
        context: { step: 3, data: 'test' },
        maxRetries: 5,
        expiresIn: 300000, // 5 minutes
      });

      expect(mockAddPendingAsk).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 'test-conv',
        agentName: 'test-agent',
        question: 'What is your name?',
        context: { step: 3, data: 'test' },
        maxRetries: 5,
        expiresAt: expect.any(Date),
      }));
    });
  });

  describe('getPendingAsk', () => {
    it('should return pending ask from registry', () => {
      const agent = new TestAgent(mockToolpack);
      const mockPendingAsk = {
        id: 'test-conv:test-agent:1234567890',
        conversationId: 'test-conv',
        agentName: 'test-agent',
        question: 'What is your name?',
        context: {},
        maxRetries: 2,
        status: 'pending' as const,
        retries: 0,
        askedAt: new Date(),
      };
      const mockRegistry = {
        getPendingAsk: vi.fn().mockReturnValue(mockPendingAsk),
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._conversationId = 'test-conv';

      const result = agent['getPendingAsk']();

      expect(result).toEqual(mockPendingAsk);
      expect(mockRegistry.getPendingAsk).toHaveBeenCalledWith('test-conv');
    });

    it('should return null if no registry', () => {
      const agent = new TestAgent(mockToolpack);
      agent._conversationId = 'test-conv';

      const result = agent['getPendingAsk']();

      expect(result).toBeNull();
    });

    it('should return null if no conversationId', () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = { getPendingAsk: vi.fn() };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;

      const result = agent['getPendingAsk']();

      expect(result).toBeNull();
    });
  });

  describe('resolvePendingAsk', () => {
    it('should resolve pending ask in registry', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockResolvePendingAsk = vi.fn().mockResolvedValue(undefined);
      const mockRegistry = {
        resolvePendingAsk: mockResolvePendingAsk,
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;

      await agent['resolvePendingAsk']('ask-id-123', 'John');

      expect(mockResolvePendingAsk).toHaveBeenCalledWith('ask-id-123', 'John');
    });

    it('should throw if no registry', async () => {
      const agent = new TestAgent(mockToolpack);

      await expect(agent['resolvePendingAsk']('ask-id-123', 'John')).rejects.toThrow(
        'Agent not registered - cannot resolve ask'
      );
    });
  });

  describe('evaluateAnswer', () => {
    it('should use simpleValidation when provided', async () => {
      const agent = new TestAgent(mockToolpack);
      const simpleValidation = vi.fn().mockReturnValue(true);

      const result = await agent['evaluateAnswer']('What is your name?', 'John', {
        simpleValidation,
      });

      expect(simpleValidation).toHaveBeenCalledWith('John');
      expect(result).toBe(true);
      expect(mockToolpack.generate).not.toHaveBeenCalled(); // No LLM call
    });

    it('should use LLM when simpleValidation not provided', async () => {
      const evaluationToolpack = createMockToolpack();
      vi.mocked(evaluationToolpack.generate).mockResolvedValue({
        content: 'yes',
        usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 },
      });

      const agent = new TestAgent(evaluationToolpack);

      const result = await agent['evaluateAnswer']('What is your name?', 'John');

      expect(evaluationToolpack.generate).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when LLM evaluation returns no', async () => {
      const evaluationToolpack = createMockToolpack();
      vi.mocked(evaluationToolpack.generate).mockResolvedValue({
        content: 'no',
        usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 },
      });

      const agent = new TestAgent(evaluationToolpack);

      const result = await agent['evaluateAnswer']('What is your name?', '');

      expect(result).toBe(false);
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

  describe('knowledge integration', () => {
    it('should inject knowledge.toTool() when knowledge is set', async () => {
      const mockKnowledgeTool = {
        name: 'knowledge_search',
        description: 'Search knowledge base',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        execute: vi.fn(),
      };

      const mockKnowledge = {
        query: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockResolvedValue('chunk-id'),
        toTool: vi.fn().mockReturnValue(mockKnowledgeTool),
      };

      const agent = new TestAgent(mockToolpack);
      agent.knowledge = mockKnowledge as unknown as NonNullable<typeof agent.knowledge>;
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-conv',
      });

      // Verify knowledge.toTool() was called
      expect(mockKnowledge.toTool).toHaveBeenCalled();

      // Verify the tool was passed to generate in converted ToolCallRequest format
      expect(mockToolpack.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'knowledge_search',
                description: 'Search knowledge base',
                parameters: mockKnowledgeTool.parameters,
              },
            },
          ],
        }),
        expect.anything()
      );
    });

    it('should not inject tools when knowledge is not set', async () => {
      const agent = new TestAgent(mockToolpack);
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-conv',
      });

      // Verify no tools were passed
      expect(mockToolpack.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: undefined,
        }),
        expect.anything()
      );
    });

    it('should fetch conversation history from knowledge when available', async () => {
      const mockKnowledgeTool = {
        name: 'knowledge_search',
        description: 'Search knowledge base',
        execute: vi.fn(),
      };

      const historyResults = [
        {
          chunk: {
            content: 'Hello from user',
            metadata: { role: 'user', timestamp: '2024-01-01T00:00:00Z' },
          },
          score: 0.9,
        },
        {
          chunk: {
            content: 'Hello from assistant',
            metadata: { role: 'assistant', timestamp: '2024-01-01T00:00:01Z' },
          },
          score: 0.9,
        },
      ];

      const mockKnowledge = {
        query: vi.fn().mockResolvedValue(historyResults),
        add: vi.fn().mockResolvedValue('chunk-id'),
        toTool: vi.fn().mockReturnValue(mockKnowledgeTool),
      };

      const agent = new TestAgent(mockToolpack);
      agent.knowledge = mockKnowledge as unknown as NonNullable<typeof agent.knowledge>;
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'New message',
        conversationId: 'test-conv',
      });

      // Verify knowledge.query was called with correct parameters
      expect(mockKnowledge.query).toHaveBeenCalledWith(
        'conversation test-conv',
        expect.objectContaining({
          limit: 10,
          filter: { conversationId: 'test-conv', type: 'conversation_message' },
        })
      );

      // Verify the messages were injected into generate
      expect(mockToolpack.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'user', content: 'Hello from user' },
            { role: 'assistant', content: 'Hello from assistant' },
            { role: 'user', content: 'New message' },
          ]),
        }),
        expect.anything()
      );
    });

    it('should skip history entries without valid role metadata', async () => {
      const mockKnowledgeTool = {
        name: 'knowledge_search',
        description: 'Search knowledge base',
        execute: vi.fn(),
      };

      const historyResults = [
        {
          chunk: {
            content: 'Valid user message',
            metadata: { role: 'user', timestamp: '2024-01-01T00:00:00Z' },
          },
          score: 0.9,
        },
        {
          chunk: {
            content: 'Message without role metadata',
            metadata: { timestamp: '2024-01-01T00:00:01Z' },
          },
          score: 0.9,
        },
        {
          chunk: {
            content: 'Message with invalid role',
            metadata: { role: 'system', timestamp: '2024-01-01T00:00:02Z' },
          },
          score: 0.9,
        },
      ];

      const mockKnowledge = {
        query: vi.fn().mockResolvedValue(historyResults),
        add: vi.fn().mockResolvedValue('chunk-id'),
        toTool: vi.fn().mockReturnValue(mockKnowledgeTool),
      };

      const agent = new TestAgent(mockToolpack);
      agent.knowledge = mockKnowledge as unknown as NonNullable<typeof agent.knowledge>;
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'New message',
        conversationId: 'test-conv',
      });

      // Verify only valid entries were included
      const generateCall = vi.mocked(mockToolpack.generate).mock.calls[0];
      const request = generateCall[0] as { messages: Array<{ role: string; content: string }> };
      const messages = request.messages;

      expect(messages).toContainEqual({ role: 'user', content: 'Valid user message' });
      expect(messages).not.toContainEqual({ role: expect.any(String), content: 'Message without role metadata' });
      expect(messages).not.toContainEqual({ role: expect.any(String), content: 'Message with invalid role' });
    });

    it('should store exchange in knowledge after response', async () => {
      const mockKnowledgeTool = {
        name: 'knowledge_search',
        description: 'Search knowledge base',
        execute: vi.fn(),
      };

      const mockKnowledge = {
        query: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockResolvedValue('chunk-id'),
        toTool: vi.fn().mockReturnValue(mockKnowledgeTool),
      };

      const agent = new TestAgent(mockToolpack);
      agent.knowledge = mockKnowledge as unknown as NonNullable<typeof agent.knowledge>;
      agent.name = 'test-agent';
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'User question',
        conversationId: 'test-conv',
      });

      // Verify both user message and agent response were stored
      expect(mockKnowledge.add).toHaveBeenCalledTimes(2);

      // First call stores user message
      expect(mockKnowledge.add).toHaveBeenNthCalledWith(
        1,
        'User question',
        expect.objectContaining({
          conversationId: 'test-conv',
          type: 'conversation_message',
          role: 'user',
          agentName: 'test-agent',
        })
      );

      // Second call stores agent response
      expect(mockKnowledge.add).toHaveBeenNthCalledWith(
        2,
        'Mock AI response',
        expect.objectContaining({
          conversationId: 'test-conv',
          type: 'conversation_message',
          role: 'assistant',
          agentName: 'test-agent',
        })
      );
    });

    it('should skip knowledge operations when conversationId is undefined', async () => {
      const mockKnowledgeTool = {
        name: 'knowledge_search',
        description: 'Search knowledge base',
        execute: vi.fn(),
      };

      const mockKnowledge = {
        query: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockResolvedValue('chunk-id'),
        toTool: vi.fn().mockReturnValue(mockKnowledgeTool),
      };

      const agent = new TestAgent(mockToolpack);
      agent.knowledge = mockKnowledge as unknown as NonNullable<typeof agent.knowledge>;

      await agent.invokeAgent({
        message: 'Test message',
        // No conversationId
      });

      // Verify knowledge operations were skipped
      expect(mockKnowledge.query).not.toHaveBeenCalled();
      expect(mockKnowledge.add).not.toHaveBeenCalled();

      // But tool was still injected
      expect(mockKnowledge.toTool).toHaveBeenCalled();
    });

    it('should continue without history when knowledge query fails', async () => {
      const mockKnowledgeTool = {
        name: 'knowledge_search',
        description: 'Search knowledge base',
        execute: vi.fn(),
      };

      const mockKnowledge = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
        add: vi.fn().mockResolvedValue('chunk-id'),
        toTool: vi.fn().mockReturnValue(mockKnowledgeTool),
      };

      const agent = new TestAgent(mockToolpack);
      agent.knowledge = mockKnowledge as unknown as NonNullable<typeof agent.knowledge>;
      agent._conversationId = 'test-conv';

      // Should not throw
      const result = await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-conv',
      });

      // Verify agent still completed successfully
      expect(result.output).toBe('Mock AI response');

      // Verify generate was still called (just without history messages)
      expect(mockToolpack.generate).toHaveBeenCalled();
    });

    it('should continue when knowledge storage fails', async () => {
      const mockKnowledgeTool = {
        name: 'knowledge_search',
        description: 'Search knowledge base',
        execute: vi.fn(),
      };

      const mockKnowledge = {
        query: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockRejectedValue(new Error('Storage failed')),
        toTool: vi.fn().mockReturnValue(mockKnowledgeTool),
      };

      const agent = new TestAgent(mockToolpack);
      agent.knowledge = mockKnowledge as unknown as NonNullable<typeof agent.knowledge>;
      agent._conversationId = 'test-conv';

      // Should not throw
      const result = await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-conv',
      });

      // Verify agent still completed successfully
      expect(result.output).toBe('Mock AI response');
    });
  });

  describe('handlePendingAsk', () => {
    it('should resolve ask and call onSufficient when answer is sufficient', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockResolvePendingAsk = vi.fn().mockResolvedValue(undefined);
      const mockOnSufficient = vi.fn().mockResolvedValue({ output: 'Task continued' });

      agent._registry = {
        resolvePendingAsk: mockResolvePendingAsk,
      } as unknown as import('./types.js').IAgentRegistry;

      const pendingAsk = {
        id: 'ask-123',
        conversationId: 'conv-123',
        agentName: 'test-agent',
        question: 'What is your name?',
        status: 'pending' as const,
        retries: 0,
        maxRetries: 2,
        askedAt: new Date(),
        channelName: 'slack',
        context: { step: 1 },
      } as import('./types.js').PendingAsk;

      // Mock evaluateAnswer to return true (sufficient)
      vi.spyOn(agent as unknown as { evaluateAnswer: () => Promise<boolean> }, 'evaluateAnswer').mockResolvedValue(true);

      const result = await agent['handlePendingAsk'](pendingAsk, 'John Doe', mockOnSufficient);

      // Verify ask was resolved
      expect(mockResolvePendingAsk).toHaveBeenCalledWith('ask-123', 'John Doe');

      // Verify onSufficient was called
      expect(mockOnSufficient).toHaveBeenCalledWith('John Doe');

      // Verify result
      expect(result.output).toBe('Task continued');
    });

    it('should re-ask when answer is insufficient and retries remain', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = {
        resolvePendingAsk: vi.fn().mockResolvedValue(undefined),
        incrementRetries: vi.fn().mockReturnValue(1),
        sendTo: vi.fn().mockResolvedValue(undefined),
        addPendingAsk: vi.fn().mockReturnValue({
          id: 'ask-456',
          question: 'I need a bit more clarity on: "What is your name?". Could you provide more details?',
          status: 'pending',
        }),
      };

      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack';
      agent._conversationId = 'conv-123';

      const pendingAsk = {
        id: 'ask-123',
        conversationId: 'conv-123',
        agentName: 'test-agent',
        question: 'What is your name?',
        status: 'pending' as const,
        retries: 0,
        maxRetries: 2,
        askedAt: new Date(),
        channelName: 'slack',
        context: { step: 1 },
      } as import('./types.js').PendingAsk;

      // Mock evaluateAnswer to return false (insufficient)
      vi.spyOn(agent as unknown as { evaluateAnswer: () => Promise<boolean> }, 'evaluateAnswer').mockResolvedValue(false);

      const mockOnSufficient = vi.fn();

      const result = await agent['handlePendingAsk'](pendingAsk, 'J', mockOnSufficient);

      // Verify retry counter was incremented
      expect(mockRegistry.incrementRetries).toHaveBeenCalledWith('ask-123');

      // Verify onSufficient was NOT called
      expect(mockOnSufficient).not.toHaveBeenCalled();

      // Verify result indicates waiting for human (re-ask)
      expect(result.metadata?.waitingForHuman).toBe(true);
    });

    it('should skip step when maxRetries exceeded and onInsufficient not provided', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = {
        resolvePendingAsk: vi.fn().mockResolvedValue(undefined),
        sendTo: vi.fn().mockResolvedValue(undefined),
      };

      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack';
      agent._conversationId = 'conv-123';

      const pendingAsk = {
        id: 'ask-123',
        question: 'What is your name?',
        retries: 2, // Already at max
        maxRetries: 2,
        context: { step: 1 },
      } as import('./types.js').PendingAsk;

      // Mock evaluateAnswer to return false (insufficient)
      vi.spyOn(agent as unknown as { evaluateAnswer: () => Promise<boolean> }, 'evaluateAnswer').mockResolvedValue(false);

      const mockOnSufficient = vi.fn();

      const result = await agent['handlePendingAsk'](pendingAsk, 'J', mockOnSufficient);

      // Verify ask was resolved with __insufficient__ marker
      expect(mockRegistry.resolvePendingAsk).toHaveBeenCalledWith('ask-123', '__insufficient__');

      // Verify user was notified (sendTo receives { output: message } object)
      expect(mockRegistry.sendTo).toHaveBeenCalledWith(
        'slack',
        { output: 'I was unable to get enough information to proceed. Skipping this step.' }
      );

      // Verify onSufficient was NOT called
      expect(mockOnSufficient).not.toHaveBeenCalled();

      // Verify fallback result
      expect(result.output).toBe('Step skipped due to insufficient input.');
      expect(result.metadata?.skipped).toBe(true);
      expect(result.metadata?.askId).toBe('ask-123');
    });

    it('should call custom onInsufficient callback when maxRetries exceeded', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = {
        resolvePendingAsk: vi.fn().mockResolvedValue(undefined),
        sendTo: vi.fn().mockResolvedValue(undefined),
      };

      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack';

      const pendingAsk = {
        id: 'ask-123',
        conversationId: 'conv-123',
        agentName: 'test-agent',
        question: 'What is your name?',
        status: 'pending' as const,
        retries: 2,
        maxRetries: 2,
        askedAt: new Date(),
        channelName: 'slack',
        context: { step: 1 },
      } as import('./types.js').PendingAsk;

      // Mock evaluateAnswer to return false
      vi.spyOn(agent as unknown as { evaluateAnswer: () => Promise<boolean> }, 'evaluateAnswer').mockResolvedValue(false);

      const mockOnSufficient = vi.fn();
      const mockOnInsufficient = vi.fn().mockReturnValue({
        output: 'Custom fallback behavior',
        metadata: { custom: true },
      });

      const result = await agent['handlePendingAsk'](
        pendingAsk,
        'J',
        mockOnSufficient,
        mockOnInsufficient
      );

      // Verify custom callback was called
      expect(mockOnInsufficient).toHaveBeenCalled();

      // Verify custom result returned
      expect(result.output).toBe('Custom fallback behavior');
      expect(result.metadata?.custom).toBe(true);
    });

    it('should skip notification if no triggering channel available', async () => {
      const agent = new TestAgent(mockToolpack);
      const mockRegistry = {
        resolvePendingAsk: vi.fn().mockResolvedValue(undefined),
        sendTo: vi.fn().mockResolvedValue(undefined),
      };

      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      // No _triggeringChannel set

      const pendingAsk = {
        id: 'ask-123',
        conversationId: 'conv-123',
        agentName: 'test-agent',
        question: 'What is your name?',
        status: 'pending' as const,
        retries: 2,
        maxRetries: 2,
        askedAt: new Date(),
        channelName: 'slack',
        context: { step: 1 },
      } as import('./types.js').PendingAsk;

      // Mock evaluateAnswer to return false
      vi.spyOn(agent as unknown as { evaluateAnswer: () => Promise<boolean> }, 'evaluateAnswer').mockResolvedValue(false);

      const mockOnSufficient = vi.fn();

      await agent['handlePendingAsk'](pendingAsk, 'J', mockOnSufficient);

      // Verify sendTo was NOT called (no channel to send to)
      expect(mockRegistry.sendTo).not.toHaveBeenCalled();
    });
  });
});
