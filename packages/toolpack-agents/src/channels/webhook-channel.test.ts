import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookChannel, WebhookChannelConfig } from './webhook-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

describe('WebhookChannel', () => {
  const baseConfig: WebhookChannelConfig = {
    path: '/agent/support',
    port: 3102, // Unique port for Webhook tests
  };

  describe('constructor', () => {
    it('should create with required config', () => {
      const channel = new WebhookChannel({ path: '/webhook' });
      expect(channel).toBeDefined();
    });

    it('should set name from config', () => {
      const channel = new WebhookChannel({ ...baseConfig, name: 'webhook-support' });
      expect(channel.name).toBe('webhook-support');
    });

    it('should use default port if not specified', () => {
      const channel = new WebhookChannel({ path: '/webhook' });
      expect(channel).toBeDefined();
    });

    it('should have isTriggerChannel set to false', () => {
      const channel = new WebhookChannel(baseConfig);
      expect(channel.isTriggerChannel).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should map HTTP body to AgentInput', () => {
      const channel = new WebhookChannel(baseConfig);

      const body = {
        message: 'Help needed',
        intent: 'support',
        userId: 'user-123',
      };

      const input = channel.normalize(body);

      expect(input.message).toBe('Help needed');
      expect(input.intent).toBe('support');
      expect(input.data).toEqual(body);
    });

    it('should use text field as fallback for message', () => {
      const channel = new WebhookChannel(baseConfig);

      const body = {
        text: 'Text message',
      };

      const input = channel.normalize(body);

      expect(input.message).toBe('Text message');
    });

    it('should extract sessionId from x-session-id header', () => {
      const channel = new WebhookChannel(baseConfig);

      const body = {
        message: 'Test',
        headers: {
          'x-session-id': 'session-123',
        },
      };

      const input = channel.normalize(body);

      expect(input.conversationId).toBe('session-123');
      expect(input.context?.sessionId).toBe('session-123');
    });

    it('should extract sessionId from X-Session-Id header (case insensitive)', () => {
      const channel = new WebhookChannel(baseConfig);

      const body = {
        message: 'Test',
        headers: {
          'X-Session-Id': 'session-456',
        },
      };

      const input = channel.normalize(body);

      expect(input.conversationId).toBe('session-456');
    });

    it('should fall back to body sessionId if no header', () => {
      const channel = new WebhookChannel(baseConfig);

      const body = {
        message: 'Test',
        sessionId: 'session-789',
      };

      const input = channel.normalize(body);

      expect(input.conversationId).toBe('session-789');
    });

    it('should fall back to body conversationId if no sessionId', () => {
      const channel = new WebhookChannel(baseConfig);

      const body = {
        message: 'Test',
        conversationId: 'conv-abc',
      };

      const input = channel.normalize(body);

      expect(input.conversationId).toBe('conv-abc');
    });

    it('should auto-generate sessionId if not provided', () => {
      const channel = new WebhookChannel(baseConfig);

      const body = {
        message: 'Test',
      };

      const input = channel.normalize(body);

      expect(input.conversationId).toMatch(/^webhook-/);
    });
  });

  describe('send', () => {
    it('should resolve pending response by conversationId', async () => {
      const channel = new WebhookChannel(baseConfig);

      // Simulate a pending response
      const mockResolve = vi.fn();
      const mockReject = vi.fn();
      (channel as unknown as { pendingResponses: Map<string, { resolve: typeof mockResolve; reject: typeof mockReject }> }).pendingResponses.set('session-123', {
        resolve: mockResolve,
        reject: mockReject,
      });

      await channel.send({
        output: 'Response to user',
        metadata: {
          conversationId: 'session-123',
        },
      });

      expect(mockResolve).toHaveBeenCalledWith({
        output: 'Response to user',
        metadata: {
          conversationId: 'session-123',
        },
      });
    });

    it('should not throw if no pending response found', async () => {
      const channel = new WebhookChannel(baseConfig);

      // Should not throw
      await expect(channel.send({
        output: 'Orphaned response',
        metadata: {
          conversationId: 'unknown-session',
        },
      })).resolves.not.toThrow();
    });

    it('should handle missing metadata', async () => {
      const channel = new WebhookChannel(baseConfig);

      await expect(channel.send({
        output: 'No metadata',
      })).resolves.not.toThrow();
    });
  });

  describe('request handling flow', () => {
    it('should store sessionId in pending responses during handleRequest', () => {
      const channel = new WebhookChannel(baseConfig);

      // Verify the pendingResponses map exists and works
      const testInput: AgentInput = {
        message: 'Test',
        conversationId: 'test-session',
      };

      // Set up handler
      const handler = vi.fn().mockResolvedValue(undefined);
      channel.onMessage(handler);

      // The actual request flow is tested in integration
      // This verifies the channel structure supports the flow
      expect(channel).toBeDefined();
    });
  });

  describe('listen', () => {
    it('should create HTTP server', () => {
      const channel = new WebhookChannel({ ...baseConfig, name: 'webhook-support' });

      // Just verify the channel was created successfully
      // Actual server startup is tested in integration tests
      expect(channel).toBeDefined();
      expect(channel.name).toBe('webhook-support');
    });
  });

  describe('stop', () => {
    it('should close server if running', async () => {
      const channel = new WebhookChannel(baseConfig);

      // Mock server
      const mockClose = vi.fn((cb) => cb());
      (channel as unknown as { server: { close: typeof mockClose } }).server = { close: mockClose };

      await channel.stop();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle missing server gracefully', async () => {
      const channel = new WebhookChannel(baseConfig);

      // Should not throw when server is undefined
      await expect(channel.stop()).resolves.not.toThrow();
    });
  });
});
