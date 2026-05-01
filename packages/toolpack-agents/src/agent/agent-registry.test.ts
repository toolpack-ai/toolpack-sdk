import { describe, it, expect, vi } from 'vitest';
import { AgentRegistry } from './agent-registry.js';
import { BaseAgent } from './base-agent.js';
import { AgentInput, AgentResult, BaseAgentOptions } from './types.js';
import { BaseChannel } from '../channels/base-channel.js';
import type { Toolpack } from 'toolpack-sdk';
import { CHAT_MODE } from 'toolpack-sdk';

// Mock Toolpack
const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Mock response',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    setMode: vi.fn(),
    registerMode: vi.fn(),
  } as unknown as Toolpack;
};

// Test agent implementation
class TestAgent extends BaseAgent<'test_intent'> {
  name = 'test-agent';
  description = 'A test agent';
  mode = CHAT_MODE;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

  async invokeAgent(input: AgentInput<'test_intent'>): Promise<AgentResult> {
    return {
      output: `Received: ${input.message}`,
    };
  }
}

// Test channel implementation
class TestChannel extends BaseChannel {
  readonly isTriggerChannel = false;
  handler?: (input: AgentInput) => Promise<void>;
  sent: { output: string; metadata?: Record<string, unknown> }[] = [];

  listen(): void {}

  async send(output: { output: string; metadata?: Record<string, unknown> }): Promise<void> {
    this.sent.push(output as { output: string; metadata?: Record<string, unknown> });
  }

  normalize(incoming: unknown): AgentInput {
    return { message: String(incoming) };
  }

  onMessage(handler: (input: AgentInput) => Promise<void>): void {
    this.handler = handler;
  }

  async triggerMessage(input: AgentInput): Promise<void> {
    if (this.handler) {
      await this.handler(input);
    }
  }
}

describe('AgentRegistry', () => {
  describe('constructor', () => {
    it('should create with empty agents list', () => {
      const registry = new AgentRegistry([]);
      expect(registry).toBeDefined();
    });

    it('should create with agent instances', () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();
      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.channels = [channel];

      const registry = new AgentRegistry([agent]);
      expect(registry).toBeDefined();
    });
  });

  describe('start', () => {
    it('should bind message handlers and start channels', async () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();
      const spyListen = vi.spyOn(channel, 'listen');

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.channels = [channel];

      const registry = new AgentRegistry([agent]);
      await registry.start();

      expect(spyListen).toHaveBeenCalled();
      expect(channel.handler).toBeDefined();
    });

    it('should set agent registry reference', async () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.channels = [channel];

      const registry = new AgentRegistry([agent]);
      await registry.start();

      const retrieved = registry.getAgent('test-agent');
      expect(retrieved).toBeDefined();
      expect(retrieved?._registry).toBe(registry);
    });

    it('should register named channels for sendTo() routing', async () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();
      channel.name = 'test-channel';

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.channels = [channel];

      const registry = new AgentRegistry([agent]);
      await registry.start();

      const retrievedChannel = registry.getChannel('test-channel');
      expect(retrievedChannel).toBe(channel);
    });
  });

  describe('sendTo', () => {
    it('should send to named channel', async () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();
      channel.name = 'my-channel';

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.channels = [channel];

      const registry = new AgentRegistry([agent]);
      await registry.start();

      await registry.sendTo('my-channel', { output: 'Hello!' });

      expect(channel.sent).toHaveLength(1);
      expect(channel.sent[0]).toEqual({ output: 'Hello!' });
    });

    it('should throw for unknown channel', async () => {
      const registry = new AgentRegistry([]);
      await registry.start();

      await expect(registry.sendTo('unknown', { output: 'test' }))
        .rejects.toThrow('No channel registered with name "unknown"');
    });
  });

  describe('getAgent', () => {
    it('should return agent by name', async () => {
      const mockToolpack = createMockToolpack();
      const agent = new TestAgent({ toolpack: mockToolpack });

      const registry = new AgentRegistry([agent]);
      await registry.start();

      const retrieved = registry.getAgent('test-agent');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-agent');
    });

    it('should return undefined for unknown agent', async () => {
      const mockToolpack = createMockToolpack();
      const agent = new TestAgent({ toolpack: mockToolpack });

      const registry = new AgentRegistry([agent]);
      await registry.start();

      expect(registry.getAgent('unknown')).toBeUndefined();
    });
  });

  describe('getAllAgents', () => {
    it('should return all agents', async () => {
      const mockToolpack = createMockToolpack();

      class TestAgent2 extends BaseAgent {
        name = 'test-agent-2';
        description = 'Another test agent';
        mode = CHAT_MODE;

        constructor(options: BaseAgentOptions) {
          super(options);
        }

        async invokeAgent(): Promise<AgentResult> {
          return { output: 'Test 2' };
        }
      }

      const agent1 = new TestAgent({ toolpack: mockToolpack });
      const agent2 = new TestAgent2({ toolpack: mockToolpack });

      const registry = new AgentRegistry([agent1, agent2]);
      await registry.start();

      const agents = registry.getAllAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name)).toContain('test-agent');
      expect(agents.map(a => a.name)).toContain('test-agent-2');
    });
  });

  describe('stop', () => {
    it('should clear agents and channels', async () => {
      const mockToolpack = createMockToolpack();
      const agent = new TestAgent({ toolpack: mockToolpack });

      const registry = new AgentRegistry([agent]);
      await registry.start();

      expect(registry.getAgent('test-agent')).toBeDefined();

      await registry.stop();

      expect(registry.getAgent('test-agent')).toBeUndefined();
    });

    it('should stop channels with stop method', async () => {
      const mockToolpack = createMockToolpack();

      class StoppableChannel extends TestChannel {
        stopped = false;
        async stop(): Promise<void> {
          this.stopped = true;
        }
      }

      const channel = new StoppableChannel();
      channel.name = 'stoppable';

      const agent = new TestAgent({ toolpack: mockToolpack });
      agent.channels = [channel];

      const registry = new AgentRegistry([agent]);
      await registry.start();
      await registry.stop();

      expect(channel.stopped).toBe(true);
    });
  });

  describe('PendingAsksStore', () => {
    describe('addPendingAsk', () => {
      it('should add a pending ask', () => {
        const registry = new AgentRegistry([]);
        const ask = registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'What is your name?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        expect(ask.id).toBeDefined();
        expect(ask.conversationId).toBe('test-conv');
        expect(ask.question).toBe('What is your name?');
        expect(ask.status).toBe('pending');
        expect(ask.retries).toBe(0);
        expect(ask.askedAt).toBeInstanceOf(Date);
      });

      it('should queue multiple asks for same conversation', () => {
        const registry = new AgentRegistry([]);

        const ask1 = registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'First question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        const ask2 = registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'Second question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        expect(ask1.id).not.toBe(ask2.id);
      });
    });

    describe('getPendingAsk', () => {
      it('should return the first pending ask', () => {
        const registry = new AgentRegistry([]);
        registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'First question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        const pending = registry.getPendingAsk('test-conv');
        expect(pending?.question).toBe('First question?');
      });

      it('should return undefined if no pending asks', () => {
        const registry = new AgentRegistry([]);
        const pending = registry.getPendingAsk('test-conv');
        expect(pending).toBeUndefined();
      });
    });

    describe('hasPendingAsks', () => {
      it('should return true if has pending asks', () => {
        const registry = new AgentRegistry([]);
        registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'Question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        expect(registry.hasPendingAsks('test-conv')).toBe(true);
      });

      it('should return false if no pending asks', () => {
        const registry = new AgentRegistry([]);
        expect(registry.hasPendingAsks('test-conv')).toBe(false);
      });
    });

    describe('resolvePendingAsk', () => {
      it('should resolve the ask', async () => {
        const registry = new AgentRegistry([]);
        const ask = registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'Question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        await registry.resolvePendingAsk(ask.id, 'Answer');

        expect(registry.getPendingAsk('test-conv')).toBeUndefined();
      });

      it('should auto-send next ask when resolving', async () => {
        const registry = new AgentRegistry([]);
        const ask1 = registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'First question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'Second question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        expect(registry.getPendingAsk('test-conv')?.question).toBe('First question?');

        const sendToMock = vi.fn().mockResolvedValue(undefined);
        registry.sendTo = sendToMock;

        await registry.resolvePendingAsk(ask1.id, 'Answer 1');

        expect(sendToMock).toHaveBeenCalledWith('test-channel', { output: 'Second question?' });
        expect(registry.getPendingAsk('test-conv')?.question).toBe('Second question?');
      });
    });

    describe('incrementRetries', () => {
      it('should increment retry count for a pending ask', () => {
        const registry = new AgentRegistry([]);
        const ask = registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'Question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        expect(ask.retries).toBe(0);

        expect(registry.incrementRetries(ask.id)).toBe(1);
        expect(registry.incrementRetries(ask.id)).toBe(2);
      });

      it('should return undefined for non-existent ask', () => {
        const registry = new AgentRegistry([]);
        expect(registry.incrementRetries('non-existent-id')).toBeUndefined();
      });
    });

    describe('stop clears pending asks', () => {
      it('should clear pending asks on stop', async () => {
        const registry = new AgentRegistry([]);

        registry.addPendingAsk({
          conversationId: 'test-conv',
          agentName: 'test-agent',
          question: 'Question?',
          context: {},
          maxRetries: 2,
          channelName: 'test-channel',
        });

        expect(registry.hasPendingAsks('test-conv')).toBe(true);

        await registry.stop();

        expect(registry.hasPendingAsks('test-conv')).toBe(false);
      });
    });
  });
});
