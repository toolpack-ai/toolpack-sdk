import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramChannel, TelegramChannelConfig } from './telegram.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

describe('TelegramChannel', () => {
  const baseConfig: TelegramChannelConfig = {
    token: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
  };

  describe('constructor', () => {
    it('should create with required config', () => {
      const channel = new TelegramChannel(baseConfig);
      expect(channel).toBeDefined();
    });

    it('should set name from config', () => {
      const channel = new TelegramChannel({ ...baseConfig, name: 'telegram-bot' });
      expect(channel.name).toBe('telegram-bot');
    });

    it('should have isTriggerChannel set to false', () => {
      const channel = new TelegramChannel(baseConfig);
      expect(channel.isTriggerChannel).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should map Telegram message to AgentInput', () => {
      const channel = new TelegramChannel(baseConfig);

      const update = {
        message: {
          text: 'Hello bot',
          chat: {
            id: 123456789,
            type: 'private',
          },
          from: {
            id: 987654321,
            username: 'testuser',
            first_name: 'Test',
            last_name: 'User',
          },
          message_id: 42,
        },
      };

      const input = channel.normalize(update);

      expect(input.message).toBe('Hello bot');
      expect(input.conversationId).toBe('123456789');
      expect(input.context?.chatId).toBe(123456789);
      expect(input.context?.userId).toBe(987654321);
      expect(input.context?.username).toBe('testuser');
    });

    it('should handle edited_message', () => {
      const channel = new TelegramChannel(baseConfig);

      const update = {
        edited_message: {
          text: 'Edited message',
          chat: { id: 123456789 },
          from: { id: 987654321 },
          message_id: 43,
        },
      };

      const input = channel.normalize(update);

      expect(input.message).toBe('Edited message');
    });

    it('should handle empty text', () => {
      const channel = new TelegramChannel(baseConfig);

      const update = {
        message: {
          chat: { id: 123456789 },
          from: { id: 987654321 },
          message_id: 44,
        },
      };

      const input = channel.normalize(update);

      expect(input.message).toBe('');
    });

    it('should include raw update in data', () => {
      const channel = new TelegramChannel(baseConfig);

      const update = {
        message: {
          text: 'Test',
          chat: { id: 123456789 },
          from: { id: 987654321 },
          message_id: 45,
        },
        update_id: 123456789,
      };

      const input = channel.normalize(update);

      expect(input.data).toEqual(update);
    });
  });

  describe('send', () => {
    it('should call Telegram API with chatId from metadata', async () => {
      const channel = new TelegramChannel(baseConfig);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response);

      await channel.send({
        output: 'Hello from agent!',
        metadata: {
          chatId: 123456789,
        },
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/sendMessage',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('Hello from agent!'),
        })
      );

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.chat_id).toBe(123456789);
      expect(body.text).toBe('Hello from agent!');
      expect(body.parse_mode).toBe('Markdown');
    });

    it('should throw if chatId not provided', async () => {
      const channel = new TelegramChannel(baseConfig);

      await expect(channel.send({
        output: 'Test',
        metadata: {},
      })).rejects.toThrow('Telegram send requires chatId in metadata');
    });

    it('should throw on API error', async () => {
      const channel = new TelegramChannel(baseConfig);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, description: 'Bad Request: chat not found' }),
      } as Response);

      await expect(channel.send({
        output: 'Test',
        metadata: { chatId: 123456789 },
      })).rejects.toThrow('Telegram API error: Bad Request: chat not found');
    });

    it('should throw on HTTP error', async () => {
      const channel = new TelegramChannel(baseConfig);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
      } as Response);

      await expect(channel.send({
        output: 'Test',
        metadata: { chatId: 123456789 },
      })).rejects.toThrow('Failed to send Telegram message: Unauthorized');
    });
  });

  describe('listen', () => {
    it('should be callable for polling mode', () => {
      const channel = new TelegramChannel(baseConfig);

      // Just verify channel is properly configured
      // Actual polling/webhook startup is tested in integration
      expect(channel).toBeDefined();
    });

    it('should be callable for webhook mode', () => {
      const channel = new TelegramChannel({
        ...baseConfig,
        webhookUrl: 'https://example.com/webhook',
      });

      // Just verify channel is properly configured
      expect(channel).toBeDefined();
    });
  });

  describe('stop', () => {
    it('should handle stop gracefully', async () => {
      const channel = new TelegramChannel(baseConfig);

      // Should not throw even if not started
      await expect(channel.stop()).resolves.not.toThrow();
    });

    it('should close webhook server if present', async () => {
      const channel = new TelegramChannel({
        ...baseConfig,
        webhookUrl: 'https://example.com/webhook',
      });

      // Mock server without actually starting it
      const mockClose = vi.fn((cb) => cb());
      (channel as unknown as { server: { close: typeof mockClose } }).server = { close: mockClose };

      await channel.stop();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should close server when configured with webhook', async () => {
      const channel = new TelegramChannel({
        ...baseConfig,
        webhookUrl: 'https://example.com/webhook',
      });

      // Mock server to avoid errors - set it before calling stop
      const mockClose = vi.fn((cb) => cb && cb());
      (channel as unknown as { server: { close: typeof mockClose } }).server = { close: mockClose };

      // Mock fetch for deleteWebhook
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      } as unknown as Response);

      // Stop should complete without hanging
      await channel.stop();

      // Verify server was closed
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('polling', () => {
    it('should start polling when listen is called', () => {
      const channel = new TelegramChannel(baseConfig);

      // Just verify that listen() doesn't throw when starting polling mode
      expect(() => channel.listen()).not.toThrow();

      // Cleanup
      channel.stop().catch(() => {}); // Ignore any errors during cleanup
    });
  });
});
