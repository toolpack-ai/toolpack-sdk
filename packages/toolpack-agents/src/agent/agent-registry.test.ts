import { describe, it, expect, vi } from 'vitest';
import { AgentRegistry } from './agent-registry.js';
import { BaseAgent } from './base-agent.js';
import { AgentInput, AgentResult, AgentOutput } from './types.js';
import { BaseChannel } from '../channels/base-channel.js';
import type { Toolpack } from 'toolpack-sdk';

// Mock Toolpack
const createMockToolpack = () => {
  return {
    generate: vi.fn().mockResolvedValue({
      content: 'Mock response',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    setMode: vi.fn(),
  } as unknown as Toolpack;
};

// Test agent implementation
class TestAgent extends BaseAgent<'test_intent'> {
  name = 'test-agent';
  description = 'A test agent';
  mode = 'chat';

  async invokeAgent(input: AgentInput<'test_intent'>): Promise<AgentResult> {
    return {
      output: `Received: ${input.message}`,
    };
  }
}

// Test channel implementation
class TestChannel extends BaseChannel {
  handler?: (input: AgentInput) => Promise<void>;
  sent: { output: string; metadata?: Record<string, unknown> }[] = [];

  listen(): void {
    // Simulated listen - in real implementation this would set up event listeners
  }

  async send(output: { output: string; metadata?: Record<string, unknown> }): Promise<void> {
    this.sent.push(output as { output: string; metadata?: Record<string, unknown> });
  }

  normalize(incoming: unknown): AgentInput {
    return {
      message: String(incoming),
    };
  }

  onMessage(handler: (input: AgentInput) => Promise<void>): void {
    this.handler = handler;
  }

  // Expose for testing
  async triggerMessage(input: AgentInput): Promise<void> {
    if (this.handler) {
      await this.handler(input);
    }
  }
}

describe('AgentRegistry', () => {
  describe('constructor', () => {
    it('should create with empty registrations', () => {
      const registry = new AgentRegistry([]);
      expect(registry).toBeDefined();
    });

    it('should create with registrations', () => {
      const channel = new TestChannel();
      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [channel],
        },
      ]);
      expect(registry).toBeDefined();
    });
  });

  describe('start', () => {
    it('should instantiate agents and start channels', () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();
      const spyListen = vi.spyOn(channel, 'listen');

      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [channel],
        },
      ]);

      registry.start(mockToolpack);

      expect(spyListen).toHaveBeenCalled();
      expect(channel.handler).toBeDefined();
    });

    it('should set up agent registry reference', () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();

      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [channel],
        },
      ]);

      registry.start(mockToolpack);

      const agent = registry.getAgent('test-agent');
      expect(agent).toBeDefined();
      expect(agent?._registry).toBe(registry);
    });

    it('should set channel name if provided', () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();
      channel.name = 'test-channel';

      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [channel],
        },
      ]);

      registry.start(mockToolpack);

      const retrievedChannel = registry.getChannel('test-channel');
      expect(retrievedChannel).toBe(channel);
    });
  });

  describe('sendTo', () => {
    it('should send to named channel', async () => {
      const mockToolpack = createMockToolpack();
      const channel = new TestChannel();
      channel.name = 'my-channel';

      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [channel],
        },
      ]);

      registry.start(mockToolpack);

      await registry.sendTo('my-channel', { output: 'Hello!' });

      expect(channel.sent).toHaveLength(1);
      expect(channel.sent[0]).toEqual({ output: 'Hello!' });
    });

    it('should throw for unknown channel', async () => {
      const mockToolpack = createMockToolpack();
      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [],
        },
      ]);

      registry.start(mockToolpack);

      await expect(registry.sendTo('unknown', { output: 'test' }))
        .rejects.toThrow('No channel registered with name "unknown"');
    });
  });

  describe('getAgent', () => {
    it('should return agent by name', () => {
      const mockToolpack = createMockToolpack();
      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [],
        },
      ]);

      registry.start(mockToolpack);

      const agent = registry.getAgent('test-agent');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('test-agent');
    });

    it('should return undefined for unknown agent', () => {
      const mockToolpack = createMockToolpack();
      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [],
        },
      ]);

      registry.start(mockToolpack);

      const agent = registry.getAgent('unknown');
      expect(agent).toBeUndefined();
    });
  });

  describe('getAllAgents', () => {
    it('should return all agents', () => {
      const mockToolpack = createMockToolpack();

      // Create a second test agent class
      class TestAgent2 extends BaseAgent {
        name = 'test-agent-2';
        description = 'Another test agent';
        mode = 'chat';

        async invokeAgent(): Promise<AgentResult> {
          return { output: 'Test 2' };
        }
      }

      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [],
        },
        {
          agent: TestAgent2,
          channels: [],
        },
      ]);

      registry.start(mockToolpack);

      const agents = registry.getAllAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name)).toContain('test-agent');
      expect(agents.map(a => a.name)).toContain('test-agent-2');
    });
  });

  describe('stop', () => {
    it('should clear agents and channels', async () => {
      const mockToolpack = createMockToolpack();
      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [],
        },
      ]);

      registry.start(mockToolpack);
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

      const registry = new AgentRegistry([
        {
          agent: TestAgent,
          channels: [channel],
        },
      ]);

      registry.start(mockToolpack);
      await registry.stop();

      expect(channel.stopped).toBe(true);
    });
  });
});
