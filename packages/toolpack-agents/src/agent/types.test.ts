import { describe, it, expect } from 'vitest';
import type {
  AgentInput,
  AgentResult,
  AgentOutput,
  AgentRunOptions,
  WorkflowStep,
  IAgentRegistry,
  AgentInstance,
  ChannelInterface,
} from './types.js';

describe('Agent Types', () => {
  describe('AgentInput', () => {
    it('should create a valid AgentInput', () => {
      const input: AgentInput = {
        intent: 'test_intent',
        message: 'Hello agent',
        data: { key: 'value' },
        context: { user: 'test' },
        conversationId: 'thread-123',
      };

      expect(input.intent).toBe('test_intent');
      expect(input.message).toBe('Hello agent');
      expect(input.conversationId).toBe('thread-123');
    });

    it('should create a minimal AgentInput', () => {
      const input: AgentInput = {
        message: 'Test',
      };

      expect(input.message).toBe('Test');
    });

    it('should support typed intents', () => {
      type TestIntent = 'intent_a' | 'intent_b';
      const input: AgentInput<TestIntent> = {
        intent: 'intent_a',
        message: 'Test',
      };

      expect(input.intent).toBe('intent_a');
    });
  });

  describe('AgentResult', () => {
    it('should create a valid AgentResult', () => {
      const result: AgentResult = {
        output: 'Response from agent',
        steps: [
          {
            number: 1,
            description: 'Step 1',
            status: 'completed',
          },
        ],
        metadata: { key: 'value' },
      };

      expect(result.output).toBe('Response from agent');
      expect(result.steps).toHaveLength(1);
      expect(result.metadata).toEqual({ key: 'value' });
    });

    it('should create a minimal AgentResult', () => {
      const result: AgentResult = {
        output: 'Simple response',
      };

      expect(result.output).toBe('Simple response');
    });
  });

  describe('AgentOutput', () => {
    it('should create a valid AgentOutput', () => {
      const output: AgentOutput = {
        output: 'Channel message',
        metadata: { chatId: 12345 },
      };

      expect(output.output).toBe('Channel message');
      expect(output.metadata).toEqual({ chatId: 12345 });
    });
  });

  describe('WorkflowStep', () => {
    it('should create a valid WorkflowStep', () => {
      const step: WorkflowStep = {
        number: 1,
        description: 'Process data',
        status: 'completed',
        result: {
          success: true,
          output: 'Data processed',
          toolsUsed: ['tool1'],
          duration: 1000,
        },
      };

      expect(step.number).toBe(1);
      expect(step.description).toBe('Process data');
      expect(step.status).toBe('completed');
      expect(step.result?.success).toBe(true);
    });

    it('should support all status values', () => {
      const statuses: WorkflowStep['status'][] = [
        'pending',
        'in_progress',
        'completed',
        'failed',
        'skipped',
      ];

      for (const status of statuses) {
        const step: WorkflowStep = {
          number: 1,
          description: 'Test',
          status,
        };
        expect(step.status).toBe(status);
      }
    });
  });

  describe('IAgentRegistry', () => {
    it('should define IAgentRegistry structure', () => {
      const mockRegistry: IAgentRegistry = {
        start: async () => {},
        stop: async () => {},
        sendTo: async () => {},
        getAgent: () => undefined,
        getAllAgents: () => [],
        getChannel: () => undefined,
        invoke: async () => ({ output: '' }),
        getPendingAsk: () => undefined,
        addPendingAsk: (ask) => ({ ...ask, id: 'test', askedAt: new Date(), retries: 0, status: 'pending' }),
        resolvePendingAsk: async () => {},
        hasPendingAsks: () => false,
        incrementRetries: () => undefined,
        cleanupExpiredAsks: () => 0,
      };

      expect(mockRegistry.start).toBeDefined();
      expect(mockRegistry.sendTo).toBeDefined();
      expect(mockRegistry.invoke).toBeDefined();
    });
  });

  describe('AgentInstance', () => {
    it('should define AgentInstance structure', () => {
      // Type-only test
      type TestInstance = AgentInstance<'test'>;
      expect(true).toBe(true);
    });
  });

  describe('ChannelInterface', () => {
    it('should define ChannelInterface structure', () => {
      // Create a mock implementation
      const mockChannel: ChannelInterface = {
        name: 'test-channel',
        listen: () => {},
        send: async () => {},
        normalize: (incoming) => ({
          message: String(incoming),
        }),
        onMessage: () => {},
      };

      expect(mockChannel.name).toBe('test-channel');
      expect(mockChannel.listen).toBeDefined();
      expect(mockChannel.send).toBeDefined();
      expect(mockChannel.normalize).toBeDefined();
      expect(mockChannel.onMessage).toBeDefined();
    });
  });
});
