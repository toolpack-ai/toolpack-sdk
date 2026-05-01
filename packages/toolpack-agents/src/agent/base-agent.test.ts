import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseAgent } from './base-agent.js';
import { AgentInput, AgentResult, BaseAgentOptions } from './types.js';
import type { Toolpack, ConversationStore, StoredMessage, ModeConfig } from 'toolpack-sdk';
import { CHAT_MODE } from 'toolpack-sdk';

// Mock Toolpack
const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Mock AI response',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    setMode: vi.fn(),
    registerMode: vi.fn(),
  } as unknown as Toolpack;
};

const TEST_MODE: ModeConfig = {
  ...CHAT_MODE,
  name: 'test-agent-mode',
  systemPrompt: 'You are a helpful test agent.',
};

// Test agent implementation
class TestAgent extends BaseAgent<'greet' | 'help'> {
  name = 'test-agent';
  description = 'A test agent for unit testing';
  mode = TEST_MODE;
  provider = 'openai';
  model = 'gpt-4';

  beforeRunCalled = false;
  completeCalled = false;
  errorCalled = false;
  stepCompleteCalled = false;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

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
      const agent = new TestAgent({ toolpack: mockToolpack });

      expect(agent.name).toBe('test-agent');
      expect(agent.description).toBe('A test agent for unit testing');
      expect(agent.mode.name).toBe('test-agent-mode');
    });

    it('should have optional identity properties', () => {
      const agent = new TestAgent({ toolpack: mockToolpack });

      expect(agent.provider).toBe('openai');
      expect(agent.model).toBe('gpt-4');
    });

    it('should have registry reference (set by AgentRegistry)', () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      expect(agent._registry).toBeUndefined();

      const mockRegistry = { sendTo: vi.fn() };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      expect(agent._registry).toBe(mockRegistry);
    });

    it('should have triggering channel reference', () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      expect(agent._triggeringChannel).toBeUndefined();

      agent._triggeringChannel = 'slack-support';
      expect(agent._triggeringChannel).toBe('slack-support');
    });
  });

  describe('invokeAgent', () => {
    it('should handle greet intent directly', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      const result = await agent.invokeAgent({
        intent: 'greet',
        message: 'Say hello',
        conversationId: 'test-1',
      });

      expect(result.output).toBe('Hello!');
    });

    it('should use run() for help intent', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      const result = await agent.invokeAgent({
        intent: 'help',
        message: 'I need help',
        conversationId: 'test-2',
      });

      expect(result.output).toBe('Mock AI response');
      expect(mockToolpack.setMode).toHaveBeenCalledWith('test-agent-mode');
    });
  });

  describe('run() execution engine', () => {
    it('should register and set mode before generate', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-3',
      });

      expect(mockToolpack.registerMode).toHaveBeenCalledWith(TEST_MODE);
      expect(mockToolpack.setMode).toHaveBeenCalledWith('test-agent-mode');
      expect(mockToolpack.generate).toHaveBeenCalled();
    });

    it('should pass provider override to generate', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      await agent.invokeAgent({
        message: 'Test',
      });

      expect(mockToolpack.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
          model: 'gpt-4',
        }),
        'openai'
      );
    });

    it('should not inject systemPrompt directly (mode-owned now)', async () => {
      // BaseAgent no longer pushes a system message; the mode's systemPrompt is
      // injected by Toolpack.client via injectModeSystemPrompt. The mock Toolpack
      // does not perform that injection, so request.messages should contain no
      // system messages from BaseAgent itself.
      const agent = new TestAgent({ toolpack: mockToolpack });
      await agent.invokeAgent({
        message: 'Test message',
      });

      const generateCall = vi.mocked(mockToolpack.generate).mock.calls[0];
      const request = generateCall[0] as { messages: Array<{ role: string; content: string }> };

      const systemMessages = request.messages.filter(m => m.role === 'system');
      expect(systemMessages).toHaveLength(0);
    });

    it('should return AgentResult with output and metadata', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
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

      const agent = new TestAgent({ toolpack: errorToolpack });

      await expect(agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-6',
      })).rejects.toThrow('API Error');
    });
  });

  describe('lifecycle hooks', () => {
    it('should call onBeforeRun before execution', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-7',
      });

      expect(agent.beforeRunCalled).toBe(true);
    });

    it('should call onComplete after successful execution', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-8',
      });

      expect(agent.completeCalled).toBe(true);
    });

    it('should call onError when execution fails', async () => {
      const errorToolpack = createMockToolpack();
      vi.mocked(errorToolpack.generate).mockRejectedValue(new Error('API Error'));

      const agent = new TestAgent({ toolpack: errorToolpack });

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
      const agent = new TestAgent({ toolpack: mockToolpack });
      const startHandler = vi.fn();
      agent.on('agent:start', startHandler);

      await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-10',
      });

      expect(startHandler).toHaveBeenCalledWith({ message: 'Test' });
    });

    it('should emit agent:complete event', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
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

      const agent = new TestAgent({ toolpack: errorToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });

      await expect(agent['sendTo']('some-channel', 'message')).rejects.toThrow(
        'Agent not registered - _registry not set'
      );
    });

    it('should call registry.sendTo when registry is set', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
      agent._triggeringChannel = 'slack-support';
      agent._conversationId = 'test-conv';

      await expect(agent['ask']('What is your name?')).rejects.toThrow(
        'Agent not registered - cannot use ask()'
      );
    });

    it('should throw if no conversationId is available', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      const mockRegistry = { sendTo: vi.fn() };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack-support';

      await expect(agent['ask']('What is your name?')).rejects.toThrow(
        'No conversationId available - ask() requires a conversation channel'
      );
    });

    it('should throw if called from a trigger channel (ScheduledChannel)', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
      agent._conversationId = 'test-conv';

      const result = agent['getPendingAsk']();

      expect(result).toBeNull();
    });

    it('should return null if no conversationId', () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      const mockRegistry = { getPendingAsk: vi.fn() };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;

      const result = agent['getPendingAsk']();

      expect(result).toBeNull();
    });
  });

  describe('resolvePendingAsk', () => {
    it('should resolve pending ask in registry', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      const mockResolvePendingAsk = vi.fn().mockResolvedValue(undefined);
      const mockRegistry = {
        resolvePendingAsk: mockResolvePendingAsk,
      };
      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;

      await agent['resolvePendingAsk']('ask-id-123', 'John');

      expect(mockResolvePendingAsk).toHaveBeenCalledWith('ask-id-123', 'John');
    });

    it('should throw if no registry', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });

      await expect(agent['resolvePendingAsk']('ask-id-123', 'John')).rejects.toThrow(
        'Agent not registered - cannot resolve ask'
      );
    });
  });

  describe('evaluateAnswer', () => {
    it('should use simpleValidation when provided', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
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

      const agent = new TestAgent({ toolpack: evaluationToolpack });

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

      const agent = new TestAgent({ toolpack: evaluationToolpack });

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

      const agent = new TestAgent({ toolpack: planToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
      const result = await agent.invokeAgent({
        message: 'Test',
        conversationId: 'test-14',
      });

      expect(result.steps).toBeUndefined();
    });
  });

  describe('conversation history integration', () => {
    it('auto-initialises conversationHistory to InMemoryConversationStore', () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      expect(agent.conversationHistory).toBeDefined();
    });

    it('injects conversation_search tool when _conversationId is set', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-conv',
      });

      expect(mockToolpack.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestTools: expect.arrayContaining([
            expect.objectContaining({ name: 'conversation_search' }),
          ]),
        }),
        expect.anything()
      );
    });

    it('does not inject search tool when _conversationId is absent', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
      // _conversationId not set

      await agent.invokeAgent({ message: 'Test message' });

      expect(mockToolpack.generate).toHaveBeenCalledWith(
        expect.objectContaining({ requestTools: undefined }),
        expect.anything()
      );
    });

    it('loads conversation history via assemblePrompt and passes projected messages to generate', async () => {
      // Use matching agent id so addressed-only filter includes the prior turn.
      const storedMessages: StoredMessage[] = [
        { id: '1', conversationId: 'test-conv', participant: { kind: 'user', id: 'u1', displayName: 'Alice' }, content: 'Hello from user', timestamp: '2024-01-01T00:00:00Z', scope: 'channel' },
        { id: '2', conversationId: 'test-conv', participant: { kind: 'agent', id: 'test-agent' }, content: 'Hello from assistant', timestamp: '2024-01-01T00:00:01Z', scope: 'channel' },
      ];
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue(storedMessages),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      // Disable addressed-only mode so all stored messages appear in the prompt.
      agent.assemblerOptions = { addressedOnlyMode: false };
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({ message: 'New message', conversationId: 'test-conv' });

      // assemblePrompt calls store.get with an options object
      expect(mockConversationHistory.get).toHaveBeenCalledWith('test-conv', expect.any(Object));

      const generateCall = vi.mocked(mockToolpack.generate).mock.calls[0];
      const request = generateCall[0] as { messages: Array<{ role: string; content: string }> };
      const messages = request.messages;

      // User message is projected as "Alice: Hello from user" (displayName prefix)
      expect(messages.some(m => m.role === 'user' && m.content.includes('Hello from user'))).toBe(true);
      // Agent's own turn is projected as assistant role, content verbatim
      expect(messages.some(m => m.role === 'assistant' && m.content === 'Hello from assistant')).toBe(true);
      // The triggering message is appended last
      expect(messages.some(m => m.role === 'user' && m.content === 'New message')).toBe(true);
    });

    it('projects system, user, and agent turns correctly (addressed-only off)', async () => {
      const storedMessages: StoredMessage[] = [
        { id: '1', conversationId: 'test-conv', participant: { kind: 'system', id: 'system' }, content: 'You are helpful', timestamp: '2024-01-01T00:00:00Z', scope: 'channel' },
        { id: '2', conversationId: 'test-conv', participant: { kind: 'user', id: 'u1' }, content: 'Hello', timestamp: '2024-01-01T00:00:01Z', scope: 'channel' },
        { id: '3', conversationId: 'test-conv', participant: { kind: 'agent', id: 'test-agent' }, content: 'Hi!', timestamp: '2024-01-01T00:00:02Z', scope: 'channel' },
      ];
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue(storedMessages),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent.assemblerOptions = { addressedOnlyMode: false };
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({ message: 'New message', conversationId: 'test-conv' });

      const generateCall = vi.mocked(mockToolpack.generate).mock.calls[0];
      const request = generateCall[0] as { messages: Array<{ role: string; content: string }> };
      const messages = request.messages;

      expect(messages.some(m => m.role === 'system' && m.content === 'You are helpful')).toBe(true);
      expect(messages.some(m => m.role === 'user' && m.content.includes('Hello'))).toBe(true);
      expect(messages.some(m => m.role === 'assistant' && m.content === 'Hi!')).toBe(true);
      expect(messages.some(m => m.role === 'user' && m.content === 'New message')).toBe(true);
    });

    it('run() does not write to the store — capture-history interceptor owns writes', async () => {
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent._conversationId = 'test-conv';

      // Call invokeAgent directly (not through a channel) — no capture interceptor runs.
      await agent.invokeAgent({ message: 'User question', conversationId: 'test-conv' });

      // run() must NOT call append — writes belong to capture-history.
      expect(mockConversationHistory.append).not.toHaveBeenCalled();
    });

    it('should inject conversation_search as a request-scoped tool when store is available', async () => {
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'What did I say earlier?',
        conversationId: 'test-conv',
      });

      const generateCall = vi.mocked(mockToolpack.generate).mock.calls[0];
      const request = generateCall[0] as { requestTools?: Array<{ name: string }> };

      expect(request.requestTools).toBeDefined();
      expect(request.requestTools?.some(t => t.name === 'conversation_search')).toBe(true);
    });

    it('should pass a callable conversation_search request tool to the SDK', async () => {
      const matchingMessage: StoredMessage = {
        id: '1', conversationId: 'test-conv',
        participant: { kind: 'user', id: 'u1' },
        content: 'Hello world',
        timestamp: '2024-01-01T00:00:00Z',
        scope: 'channel',
      };
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([matchingMessage]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent._conversationId = 'test-conv';

      await agent.invokeAgent({
        message: 'What did I say earlier?',
        conversationId: 'test-conv',
      });

      const generateCall = vi.mocked(mockToolpack.generate).mock.calls[0];
      const request = generateCall[0] as { requestTools?: Array<{ name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }> };
      const conversationTool = request.requestTools?.find(tool => tool.name === 'conversation_search');

      expect(conversationTool).toBeDefined();
      await expect(conversationTool?.execute({ query: 'hello' })).resolves.toEqual({
        results: [{ role: 'user', content: 'Hello world', timestamp: '2024-01-01T00:00:00Z' }],
        count: 1,
      });
    });

    it('should skip conversation history operations when conversationId is undefined', async () => {
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;

      await agent.invokeAgent({
        message: 'Test message',
        // No conversationId
      });

      expect(mockConversationHistory.get).not.toHaveBeenCalled();
      expect(mockConversationHistory.append).not.toHaveBeenCalled();
    });

    it('auto-wires agentAliases from channel botUserId into addressed-only filtering', async () => {
      // When addressed-only mode is on, only messages authored by the agent
      // OR mentioning one of its ids should appear in the prompt. A stored
      // message that mentions the channel's bot user id (e.g. a Slack
      // <@U_KAEL_BOT>) must match via the auto-wired alias.
      const aliasId = 'U_KAEL_BOT';
      const storedMessages: StoredMessage[] = [
        {
          id: '1', conversationId: 'test-conv',
          participant: { kind: 'user', id: 'u_alice', displayName: 'Alice' },
          content: 'Hey team, non-addressed chatter',
          timestamp: '2024-01-01T00:00:00Z',
          scope: 'channel',
        },
        {
          id: '2', conversationId: 'test-conv',
          participant: { kind: 'user', id: 'u_alice', displayName: 'Alice' },
          content: 'Kael, what do you think?',
          timestamp: '2024-01-01T00:00:01Z',
          scope: 'channel',
          metadata: { mentions: [aliasId] },
        },
      ];
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue(storedMessages),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent._conversationId = 'test-conv';
      // Simulate a channel that exposes botUserId (as SlackChannel / TelegramChannel do).
      // The channel doesn't need to actually listen — _resolveAssemblerOptions()
      // only reads the botUserId field.
      agent.channels = [
        { name: 'slack', isTriggerChannel: false, botUserId: aliasId, onMessage: () => {}, send: async () => {}, listen: () => {} } as unknown as (typeof agent.channels)[number],
      ];
      // addressed-only is the default, but set it explicitly for clarity.
      agent.assemblerOptions = { addressedOnlyMode: true };

      await agent.invokeAgent({ message: 'New message', conversationId: 'test-conv' });

      const request = vi.mocked(mockToolpack.generate).mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      // The addressed message must have been projected in.
      expect(request.messages.some(m => m.content.includes('Kael, what do you think?'))).toBe(true);
      // The non-addressed chatter must have been filtered out.
      expect(request.messages.some(m => m.content.includes('non-addressed chatter'))).toBe(false);
    });

    it('merges manual agentAliases with channel botUserId (dedup preserved)', async () => {
      const manualAlias = 'U_KAEL_MANUAL';
      const channelAlias = 'U_KAEL_FROM_SLACK';
      const storedMessages: StoredMessage[] = [
        {
          id: '1', conversationId: 'test-conv',
          participant: { kind: 'user', id: 'u_alice' },
          content: 'Manual-alias mention',
          timestamp: '2024-01-01T00:00:00Z',
          scope: 'channel',
          metadata: { mentions: [manualAlias] },
        },
        {
          id: '2', conversationId: 'test-conv',
          participant: { kind: 'user', id: 'u_alice' },
          content: 'Channel-alias mention',
          timestamp: '2024-01-01T00:00:01Z',
          scope: 'channel',
          metadata: { mentions: [channelAlias] },
        },
      ];
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockResolvedValue(storedMessages),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent._conversationId = 'test-conv';
      agent.channels = [
        { name: 'slack', isTriggerChannel: false, botUserId: channelAlias, onMessage: () => {}, send: async () => {}, listen: () => {} } as unknown as (typeof agent.channels)[number],
      ];
      agent.assemblerOptions = { addressedOnlyMode: true, agentAliases: [manualAlias] };

      await agent.invokeAgent({ message: 'New message', conversationId: 'test-conv' });

      const request = vi.mocked(mockToolpack.generate).mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      // Both aliases should resolve to matches.
      expect(request.messages.some(m => m.content.includes('Manual-alias mention'))).toBe(true);
      expect(request.messages.some(m => m.content.includes('Channel-alias mention'))).toBe(true);
    });

    it('should continue without history when get fails', async () => {
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockRejectedValue(new Error('Query failed')),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent._conversationId = 'test-conv';

      const result = await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-conv',
      });

      expect(result.output).toBe('Mock AI response');
      expect(mockToolpack.generate).toHaveBeenCalled();
    });

    it('continues without history when assemblePrompt throws', async () => {
      const mockConversationHistory: ConversationStore = {
        get: vi.fn().mockRejectedValue(new Error('DB unavailable')),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = mockConversationHistory;
      agent._conversationId = 'test-conv';

      const result = await agent.invokeAgent({
        message: 'Test message',
        conversationId: 'test-conv',
      });

      // Should still call generate and return a result even when history fails.
      expect(result.output).toBe('Mock AI response');
      expect(mockToolpack.generate).toHaveBeenCalled();
    });

    it('should not leak conversation state between multiple agents', async () => {
      const secret1: StoredMessage = { id: 's1', conversationId: 'conv-1', participant: { kind: 'user', id: 'u1' }, content: 'Secret from agent 1: API key is abc123', timestamp: new Date().toISOString(), scope: 'channel' };
      const secret2: StoredMessage = { id: 's2', conversationId: 'conv-2', participant: { kind: 'user', id: 'u2' }, content: 'Secret from agent 2: Password is xyz789', timestamp: new Date().toISOString(), scope: 'channel' };

      const store1: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockImplementation(async (_convId: string, query: string) =>
          [secret1].filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
        ),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const store2: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockImplementation(async (_convId: string, query: string) =>
          [secret2].filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
        ),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent1 = new TestAgent({ toolpack: mockToolpack });
      agent1.conversationHistory = store1;
      agent1._conversationId = 'conv-1';

      const agent2 = new TestAgent({ toolpack: mockToolpack });
      agent2.conversationHistory = store2;
      agent2._conversationId = 'conv-2';

      await agent1.invokeAgent({ message: 'test message 1', conversationId: 'conv-1' });
      await agent2.invokeAgent({ message: 'test message 2', conversationId: 'conv-2' });

      const call1 = vi.mocked(mockToolpack.generate).mock.calls[0];
      const call2 = vi.mocked(mockToolpack.generate).mock.calls[1];

      const request1 = typeof call1[0] === 'string' ? null : call1[0];
      const request2 = typeof call2[0] === 'string' ? null : call2[0];

      expect(request1).not.toBeNull();
      expect(request2).not.toBeNull();

      const tool1 = request1!.requestTools?.find((t: { name: string }) => t.name === 'conversation_search');
      const tool2 = request2!.requestTools?.find((t: { name: string }) => t.name === 'conversation_search');

      expect(tool1).toBeDefined();
      expect(tool2).toBeDefined();

      const results1 = await tool1!.execute({ query: 'Secret' });
      const results2 = await tool2!.execute({ query: 'Secret' });

      expect(results1.count).toBe(1);
      expect(results1.results[0].content).toContain('agent 1');
      expect(results1.results[0].content).toContain('abc123');
      expect(results1.results[0].content).not.toContain('agent 2');
      expect(results1.results[0].content).not.toContain('xyz789');

      expect(results2.count).toBe(1);
      expect(results2.results[0].content).toContain('agent 2');
      expect(results2.results[0].content).toContain('xyz789');
      expect(results2.results[0].content).not.toContain('agent 1');
      expect(results2.results[0].content).not.toContain('abc123');

      expect(store1.search).toHaveBeenCalledWith('conv-1', expect.any(String), expect.any(Object));
      expect(store2.search).toHaveBeenCalledWith('conv-2', expect.any(String), expect.any(Object));
    });

    // --- Pillar 2 tests ---

    it('isolation: conversation_search cannot reach turns from a different conversation in the same store', async () => {
      // Shared store with turns for both conv-A and conv-B.
      const turnA: StoredMessage = { id: 'a1', conversationId: 'conv-A', participant: { kind: 'user', id: 'u1' }, content: 'Secret in conv-A', timestamp: new Date().toISOString(), scope: 'channel' };
      const turnB: StoredMessage = { id: 'b1', conversationId: 'conv-B', participant: { kind: 'user', id: 'u2' }, content: 'Secret in conv-B', timestamp: new Date().toISOString(), scope: 'channel' };

      const sharedStore: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        // Real scoping: only return turns whose conversationId matches the queried id.
        search: vi.fn().mockImplementation(async (convId: string) =>
          [turnA, turnB].filter(m => m.conversationId === convId)
        ),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = sharedStore;
      agent._conversationId = 'conv-A';

      await agent.invokeAgent({ message: 'test', conversationId: 'conv-A' });

      const tool = (vi.mocked(mockToolpack.generate).mock.calls[0][0] as {
        requestTools?: Array<{ name: string; execute: (args: Record<string, unknown>) => Promise<{ results: Array<{ content: string }>; count: number }> }>;
      }).requestTools?.find(t => t.name === 'conversation_search');

      expect(tool).toBeDefined();

      // The tool must call store.search with 'conv-A' (the closure-captured id).
      expect(sharedStore.search).not.toHaveBeenCalled(); // not yet — execute hasn't been called
      const result = await tool!.execute({ query: 'Secret' });

      expect(sharedStore.search).toHaveBeenCalledWith('conv-A', 'Secret', expect.any(Object));
      // conv-B's turn must not appear.
      expect(result.count).toBe(1);
      expect(result.results[0].content).toBe('Secret in conv-A');
      expect(result.results.every((r: { content: string }) => !r.content.includes('conv-B'))).toBe(true);
    });

    it('adversarial: conversation_search ignores conversationId injected into args; always uses closure-captured id', async () => {
      const legitimateTurn: StoredMessage = { id: 'l1', conversationId: 'conv-safe', participant: { kind: 'user', id: 'u1' }, content: 'Legitimate content', timestamp: new Date().toISOString(), scope: 'channel' };

      const store: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([legitimateTurn]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.conversationHistory = store;
      agent._conversationId = 'conv-safe';

      await agent.invokeAgent({ message: 'test', conversationId: 'conv-safe' });

      const tool = (vi.mocked(mockToolpack.generate).mock.calls[0][0] as {
        requestTools?: Array<{ name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }>;
      }).requestTools?.find(t => t.name === 'conversation_search');

      expect(tool).toBeDefined();

      // Simulate adversarial LLM call: injects a foreign conversationId into args.
      await tool!.execute({ query: 'foo', conversationId: 'conv-other' });

      // store.search must have been called with the closure-captured 'conv-safe', not 'conv-other'.
      expect(store.search).toHaveBeenCalledWith('conv-safe', 'foo', expect.any(Object));
      expect(store.search).not.toHaveBeenCalledWith('conv-other', expect.anything(), expect.anything());
    });

    it('delegation: delegated agent search is scoped to originating conversationId; resets for own next message', async () => {
      // An agent that properly forwards the input conversationId to run() — as a real agent would.
      class ConvAwareAgent extends BaseAgent {
        name = 'conv-aware-agent';
        description = 'Aware agent';
        mode = TEST_MODE;
        async invokeAgent(input: AgentInput): Promise<AgentResult> {
          return this.run(input.message || '', undefined, { conversationId: input.conversationId });
        }
      }

      const originatingConvId = 'orch-conv-99';
      const ownConvId = 'target-own-conv-77';

      const store: ConversationStore = {
        get: vi.fn().mockResolvedValue([]),
        append: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        deleteMessages: vi.fn().mockResolvedValue(undefined),
      };

      const delegatedAgent = new ConvAwareAgent({ toolpack: mockToolpack });
      delegatedAgent.conversationHistory = store;

      // Simulate delegation: registry calls invokeAgent with the originator's conversationId.
      await delegatedAgent.invokeAgent({ message: 'delegated task', conversationId: originatingConvId });

      const call1 = vi.mocked(mockToolpack.generate).mock.calls[0];
      const tool1 = (call1[0] as {
        requestTools?: Array<{ name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }>;
      }).requestTools?.find(t => t.name === 'conversation_search');

      expect(tool1).toBeDefined();
      await tool1!.execute({ query: 'test' });
      // During delegation, search must be scoped to the originating conversation.
      expect(store.search).toHaveBeenLastCalledWith(originatingConvId, 'test', expect.any(Object));

      vi.mocked(mockToolpack.generate).mockClear();
      vi.mocked(store.search).mockClear();

      // Next inbound message with the agent's own conversationId — search must reset.
      await delegatedAgent.invokeAgent({ message: 'own message', conversationId: ownConvId });

      const call2 = vi.mocked(mockToolpack.generate).mock.calls[0];
      const tool2 = (call2[0] as {
        requestTools?: Array<{ name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }>;
      }).requestTools?.find(t => t.name === 'conversation_search');

      expect(tool2).toBeDefined();
      await tool2!.execute({ query: 'test' });
      // After reset, search must be scoped to the agent's own conversation.
      expect(store.search).toHaveBeenLastCalledWith(ownConvId, 'test', expect.any(Object));
    });
  });

  describe('handlePendingAsk', () => {
    it('should resolve ask and call onSufficient when answer is sufficient', async () => {
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
      const mockRegistry = {
        resolvePendingAsk: vi.fn().mockResolvedValue(undefined),
        sendTo: vi.fn().mockResolvedValue(undefined),
      };

      agent._registry = mockRegistry as unknown as import('./types.js').IAgentRegistry;
      agent._triggeringChannel = 'slack';
      agent._conversationId = 'conv-123';

      const pendingAsk: import('./types.js').PendingAsk = {
        id: 'ask-123',
        conversationId: 'conv-123',
        agentName: 'test-agent',
        question: 'What is your name?',
        retries: 2, // Already at max
        maxRetries: 2,
        status: 'pending',
        askedAt: new Date(),
        context: { step: 1 },
        channelName: 'slack',
      };

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
      const agent = new TestAgent({ toolpack: mockToolpack });
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
      const agent = new TestAgent({ toolpack: mockToolpack });
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
