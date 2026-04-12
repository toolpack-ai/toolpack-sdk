import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockChannel } from './mock-channel.js';
import { MockKnowledge, createMockKnowledge, createMockKnowledgeSync } from './mock-knowledge.js';
import {
  createTestAgent,
  createMockToolpackSimple,
  createMockToolpackSequence,
} from './create-test-agent.js';
import { captureEvents } from './capture-events.js';
import { BaseAgent } from '../agent/base-agent.js';
import type { AgentInput, AgentResult } from '../agent/types.js';

describe('testing utilities', () => {
  describe('MockChannel', () => {
    it('should capture outputs sent to the channel', async () => {
      const channel = new MockChannel();

      await channel.send({ output: 'Hello' });
      await channel.send({ output: 'World' });

      expect(channel.outputs).toHaveLength(2);
      expect(channel.lastOutput?.output).toBe('World');
    });

    it('should normalize incoming messages', () => {
      const channel = new MockChannel();

      const input = channel.normalize({
        message: 'Test message',
        intent: 'test_intent',
        conversationId: 'conv-123',
        context: { threadTs: '123.456' },
      });

      expect(input.message).toBe('Test message');
      expect(input.intent).toBe('test_intent');
      expect(input.conversationId).toBe('conv-123');
      expect(input.context).toEqual({ threadTs: '123.456' });
    });

    it('should call handler when receiving a message', async () => {
      const channel = new MockChannel();
      const handler = vi.fn().mockResolvedValue(undefined);

      channel.onMessage(handler);
      await channel.receive({ message: 'Test', conversationId: 'conv-1' });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].message).toBe('Test');
    });

    it('should track inputs received', async () => {
      const channel = new MockChannel();
      channel.onMessage(vi.fn().mockResolvedValue(undefined));

      await channel.receive({ message: 'First', conversationId: 'conv-1' });
      await channel.receive({ message: 'Second', conversationId: 'conv-1' });

      expect(channel.inputs).toHaveLength(2);
      expect(channel.lastInput?.message).toBe('Second');
      expect(channel.receivedCount).toBe(2);
    });

    it('should clear all data', async () => {
      const channel = new MockChannel();
      await channel.send({ output: 'Test' });

      channel.clear();

      expect(channel.outputs).toHaveLength(0);
      expect(channel.inputs).toHaveLength(0);
    });

    it('should throw if receiving without handler', async () => {
      const channel = new MockChannel();

      await expect(channel.receive({ message: 'Test' })).rejects.toThrow(
        'no message handler registered'
      );
    });

    it('should assert output contains text', async () => {
      const channel = new MockChannel();
      await channel.send({ output: 'Hello world!' });

      channel.assertOutputContains('world');

      expect(() => channel.assertOutputContains('missing')).toThrow('no output containing "missing"');
    });

    it('should assert last output', async () => {
      const channel = new MockChannel();
      await channel.send({ output: 'First' });
      await channel.send({ output: 'Second' });

      channel.assertLastOutput('Second');

      expect(() => channel.assertLastOutput('Wrong')).toThrow('last output mismatch');
    });

    it('should handle isListening state', () => {
      const channel = new MockChannel();

      expect(channel.isListening).toBe(false);

      channel.listen();
      expect(channel.isListening).toBe(true);

      channel.stop();
      expect(channel.isListening).toBe(false);
    });

    it('should receive message with convenience method', async () => {
      const channel = new MockChannel();
      const handler = vi.fn().mockResolvedValue(undefined);
      channel.onMessage(handler);

      await channel.receiveMessage('Hello', 'conv-123', 'greet', { foo: 'bar' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Hello',
          conversationId: 'conv-123',
          intent: 'greet',
          context: { foo: 'bar' },
        })
      );
    });
  });

  describe('MockKnowledge', () => {
    it('should create async knowledge with initial chunks', async () => {
      const knowledge = await createMockKnowledge({
        initialChunks: [
          { content: 'Test content here', metadata: { source: 'test' } },
        ],
      });

      // Query with same text to match via vector similarity
      const results = await knowledge.query('Test content here');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.content).toBe('Test content here');
    });

    it('should query with keyword matching', async () => {
      const knowledge = createMockKnowledgeSync({
        initialChunks: [
          { content: 'Apple is a fruit', metadata: { category: 'fruit' } },
          { content: 'Banana is yellow', metadata: { category: 'fruit' } },
          { content: 'Carrot is orange', metadata: { category: 'vegetable' } },
        ],
      });

      const results = await knowledge.query('apple');

      expect(results).toHaveLength(1);
      expect(results[0].chunk.content).toBe('Apple is a fruit');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should add content', async () => {
      const knowledge = createMockKnowledgeSync();

      const id = await knowledge.add('New content', { source: 'test' });

      expect(id).toBeDefined();
      expect(knowledge.getAllChunks()).toHaveLength(1);

      const results = await knowledge.query('New');
      expect(results).toHaveLength(1);
    });

    it('should filter by metadata', async () => {
      const knowledge = createMockKnowledgeSync({
        initialChunks: [
          { content: 'Apple fruit', metadata: { category: 'fruit' } },
          { content: 'Carrot vegetable', metadata: { category: 'vegetable' } },
        ],
      });

      const results = await knowledge.query('fruit', { filter: { category: 'fruit' } });

      expect(results).toHaveLength(1);
      expect(results[0].chunk.content).toBe('Apple fruit');
    });

    it('should clear all chunks', async () => {
      const knowledge = createMockKnowledgeSync({
        initialChunks: [{ content: 'Test' }],
      });

      knowledge.clear();

      expect(knowledge.getAllChunks()).toHaveLength(0);
    });

    it('should convert to tool', async () => {
      const knowledge = createMockKnowledgeSync({
        initialChunks: [{ content: 'Test info' }],
      });

      const tool = knowledge.toTool();

      expect(tool.name).toBe('knowledge_search');
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();

      const results = await tool.execute({ query: 'info' });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Test info');
    });

    it('should respect limit option', async () => {
      const knowledge = createMockKnowledgeSync({
        initialChunks: [
          { content: 'One number' },
          { content: 'Two number' },
          { content: 'Three number' },
        ],
      });

      const results = await knowledge.query('number', { limit: 2 });

      expect(results).toHaveLength(2);
    });
  });

  describe('createTestAgent', () => {
    class TestAgent extends BaseAgent {
      name = 'test-agent';
      description = 'A test agent';
      mode = 'chat';

      async invokeAgent(input: AgentInput): Promise<AgentResult> {
        const result = await this.run(input.message || '');
        return result;
      }
    }

    it('should create agent with mock channel', async () => {
      const { agent, channel } = createTestAgent(TestAgent);

      expect(agent).toBeInstanceOf(TestAgent);
      expect(channel).toBeInstanceOf(MockChannel);
      expect(agent.name).toBe('test-agent');
    });

    it('should route messages through channel to agent', async () => {
      const { channel } = createTestAgent(TestAgent, {
        mockResponses: [{ trigger: 'hello', response: 'Hi there!' }],
      });

      await channel.receiveMessage('hello', 'conv-1');

      expect(channel.lastOutput?.output).toBe('Hi there!');
    });

    it('should return default response when no trigger matches', async () => {
      const { channel } = createTestAgent(TestAgent, {
        defaultResponse: 'Default answer',
      });

      await channel.receiveMessage('unknown query', 'conv-1');

      expect(channel.lastOutput?.output).toBe('Default answer');
    });

    it('should add more mock responses', async () => {
      const { channel, addMockResponse } = createTestAgent(TestAgent);

      addMockResponse({ trigger: 'new', response: 'New response' });

      await channel.receiveMessage('new', 'conv-1');

      expect(channel.lastOutput?.output).toBe('New response');
    });

    it('should support regex triggers', async () => {
      const { channel } = createTestAgent(TestAgent, {
        mockResponses: [{ trigger: /\d+/, response: 'Number detected' }],
      });

      await channel.receiveMessage('The answer is 42', 'conv-1');

      expect(channel.lastOutput?.output).toBe('Number detected');
    });
  });

  describe('createMockToolpackSimple', () => {
    it('should return same response for all calls', async () => {
      const toolpack = createMockToolpackSimple('Always this');

      const result1 = await toolpack.generate({ messages: [{ role: 'user', content: 'Q1' }], model: 'gpt-4' });
      const result2 = await toolpack.generate({ messages: [{ role: 'user', content: 'Q2' }], model: 'gpt-4' });

      expect(result1.content).toBe('Always this');
      expect(result2.content).toBe('Always this');
    });
  });

  describe('createMockToolpackSequence', () => {
    it('should return responses in sequence', async () => {
      const toolpack = createMockToolpackSequence(['First', 'Second', 'Third']);

      const result1 = await toolpack.generate({ messages: [], model: 'gpt-4' });
      const result2 = await toolpack.generate({ messages: [], model: 'gpt-4' });
      const result3 = await toolpack.generate({ messages: [], model: 'gpt-4' });
      const result4 = await toolpack.generate({ messages: [], model: 'gpt-4' });

      expect(result1.content).toBe('First');
      expect(result2.content).toBe('Second');
      expect(result3.content).toBe('Third');
      expect(result4.content).toBe('No more mock responses');
    });
  });

  describe('captureEvents', () => {
    class EventfulAgent extends BaseAgent {
      name = 'eventful-agent';
      description = 'An agent that emits events';
      mode = 'chat';

      async invokeAgent(input: AgentInput): Promise<AgentResult> {
        this.emit('agent:start', { message: input.message });
        this.emit('agent:complete', { output: 'Done' });
        return { output: 'Done' };
      }
    }

    it('should capture agent events', async () => {
      const toolpack = createMockToolpackSimple();
      const agent = new EventfulAgent(toolpack);
      const capture = captureEvents(agent);

      await agent.invokeAgent({ message: 'Test' });

      expect(capture.hasEvent('agent:start')).toBe(true);
      expect(capture.hasEvent('agent:complete')).toBe(true);
      expect(capture.count).toBe(2);
    });

    it('should get events by name', async () => {
      const toolpack = createMockToolpackSimple();
      const agent = new EventfulAgent(toolpack);
      const capture = captureEvents(agent);

      await agent.invokeAgent({ message: 'Test' });

      const startEvents = capture.getEvents('agent:start');
      expect(startEvents).toHaveLength(1);
      expect(startEvents[0].name).toBe('agent:start');
    });

    it('should get first and last events', async () => {
      const toolpack = createMockToolpackSimple();
      const agent = new EventfulAgent(toolpack);
      const capture = captureEvents(agent);

      await agent.invokeAgent({ message: 'Test' });

      expect(capture.getFirstEvent('agent:start')).toBeDefined();
      expect(capture.getLastEvent('agent:complete')).toBeDefined();
    });

    it('should clear events', async () => {
      const toolpack = createMockToolpackSimple();
      const agent = new EventfulAgent(toolpack);
      const capture = captureEvents(agent);

      await agent.invokeAgent({ message: 'Test' });
      capture.clear();

      expect(capture.count).toBe(0);
      expect(capture.hasEvent('agent:start')).toBe(false);
    });

    it('should assert event presence', async () => {
      const toolpack = createMockToolpackSimple();
      const agent = new EventfulAgent(toolpack);
      const capture = captureEvents(agent);

      await agent.invokeAgent({ message: 'Test' });

      capture.assertEvent('agent:start');
      capture.assertEvent('agent:complete');

      expect(() => capture.assertEvent('agent:error')).toThrow(
        'expected event "agent:error" was not captured'
      );
    });

    it('should assert event absence', async () => {
      const toolpack = createMockToolpackSimple();
      const agent = new EventfulAgent(toolpack);
      const capture = captureEvents(agent);

      await agent.invokeAgent({ message: 'Test' });

      capture.assertNoEvent('agent:error');

      expect(() => capture.assertNoEvent('agent:start')).toThrow(
        'unexpected event "agent:start" was captured'
      );
    });

    it('should stop capturing and remove listeners', async () => {
      const toolpack = createMockToolpackSimple();
      const agent = new EventfulAgent(toolpack);
      const capture = captureEvents(agent);

      capture.stop();
      await agent.invokeAgent({ message: 'Test' });

      // Events were emitted but capture was stopped
      expect(capture.count).toBe(0);
    });
  });
});
