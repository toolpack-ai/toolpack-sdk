import { describe, it, expect, vi } from 'vitest';
import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

// Test implementation of BaseChannel
class TestChannel extends BaseChannel {
  listened = false;
  sent: AgentOutput[] = [];
  normalized: unknown[] = [];

  listen(): void {
    this.listened = true;
  }

  async send(output: AgentOutput): Promise<void> {
    this.sent.push(output);
  }

  normalize(incoming: unknown): AgentInput {
    this.normalized.push(incoming);
    return {
      message: String(incoming),
    };
  }
}

describe('BaseChannel', () => {
  describe('name property', () => {
    it('should support optional name', () => {
      const channel = new TestChannel();
      expect(channel.name).toBeUndefined();

      channel.name = 'test-channel';
      expect(channel.name).toBe('test-channel');
    });
  });

  describe('onMessage', () => {
    it('should set handler', async () => {
      const channel = new TestChannel();
      const handler = vi.fn().mockResolvedValue(undefined);

      channel.onMessage(handler);

      // Trigger handler via protected handleMessage method
      const input: AgentInput = { message: 'test' };
      await (channel as unknown as { handleMessage(input: AgentInput): Promise<void> }).handleMessage(input);

      expect(handler).toHaveBeenCalledWith(input);
    });
  });

  describe('abstract methods', () => {
    it('should require listen implementation', () => {
      const channel = new TestChannel();

      channel.listen();
      expect(channel.listened).toBe(true);
    });

    it('should require send implementation', async () => {
      const channel = new TestChannel();

      const output: AgentOutput = { output: 'test' };
      await channel.send(output);

      expect(channel.sent).toContainEqual(output);
    });

    it('should require normalize implementation', () => {
      const channel = new TestChannel();

      const input = channel.normalize('test-input');

      expect(channel.normalized).toContainEqual('test-input');
      expect(input.message).toBe('test-input');
    });
  });

  describe('normalize patterns', () => {
    it('should handle string input', () => {
      const channel = new TestChannel();
      const input = channel.normalize('hello');

      expect(input.message).toBe('hello');
    });

    it('should handle object input', () => {
      const channel = new TestChannel();
      const input = channel.normalize({ text: 'hello', user: 'test' });

      expect(input.message).toBe('[object Object]');
    });

    it('should handle complex input with all fields', () => {
      class ComplexChannel extends BaseChannel {
        listen(): void {}
        async send(): Promise<void> {}
        normalize(incoming: unknown): AgentInput {
          const data = incoming as Record<string, unknown>;
          return {
            intent: data.intent as string,
            message: data.text as string,
            data: incoming,
            context: { source: data.source as string },
            conversationId: data.threadId as string,
          };
        }
      }

      const channel = new ComplexChannel();
      const input = channel.normalize({
        intent: 'greeting',
        text: 'Hello!',
        source: 'slack',
        threadId: 'thread-123',
      });

      expect(input.intent).toBe('greeting');
      expect(input.message).toBe('Hello!');
      expect(input.conversationId).toBe('thread-123');
      expect(input.context?.source).toBe('slack');
    });
  });
});
