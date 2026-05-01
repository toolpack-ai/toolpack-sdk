import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramChannel, TelegramChannelConfig } from './telegram-channel.js';
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

  describe('normalize - participant', () => {
    it('populates participant with stringified id and first_name as displayName', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'hi',
          chat: { id: 123456789 },
          from: { id: 987654321, first_name: 'Alice', username: 'alice_tg' },
          message_id: 1,
        },
      });
      expect(input.participant).toEqual({
        kind: 'user',
        id: '987654321',        // number coerced to string
        displayName: 'Alice',   // first_name takes precedence
      });
    });

    it('falls back to username when first_name is absent', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'hi',
          chat: { id: 111 },
          from: { id: 222, username: 'bob_bot' },
          message_id: 2,
        },
      });
      expect(input.participant?.displayName).toBe('bob_bot');
    });

    it('falls back to stringified id when no name fields present', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'hi',
          chat: { id: 111 },
          from: { id: 333 },
          message_id: 3,
        },
      });
      expect(input.participant?.displayName).toBe('333');
    });

    it('leaves participant undefined when from is absent', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'system message',
          chat: { id: 111 },
          message_id: 4,
        },
      });
      expect(input.participant).toBeUndefined();
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

    it('advances offset correctly — no double-increment that would skip updates', async () => {
      const channel = new TelegramChannel(baseConfig);

      global.fetch = vi.fn()
        // First poll: returns update_id 1 and 3
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            result: [
              { update_id: 1, message: { text: 'a', chat: { id: 100 }, from: { id: 1 }, message_id: 1 } },
              { update_id: 3, message: { text: 'b', chat: { id: 100 }, from: { id: 1 }, message_id: 2 } },
            ],
          }),
        } as Response)
        // Second poll — offset must be 4 (last update_id + 1), not 5 (which would skip update_id=4)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, result: [] }),
        } as Response);

      await (channel as any).pollUpdates();
      await (channel as any).pollUpdates();

      const secondCallUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
      expect(secondCallUrl).toContain('offset=4');
    });
  });

  describe('normalize — channel context', () => {
    it('sets channelType to "private" for DM chats so defaultGetScope returns dm scope', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'private message',
          chat: { id: 555, type: 'private' },
          from: { id: 100 },
          message_id: 1,
        },
      });
      expect(input.context?.channelType).toBe('private');
    });

    it('sets channelType to "group" for group chats', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'group message',
          chat: { id: 777, type: 'group', title: 'Project Kore' },
          from: { id: 100 },
          message_id: 2,
        },
      });
      expect(input.context?.channelType).toBe('group');
    });

    it('sets channelName from chat.title for group chats', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'hi team',
          chat: { id: 777, type: 'group', title: 'Project Kore' },
          from: { id: 100 },
          message_id: 3,
        },
      });
      expect(input.context?.channelName).toBe('Project Kore');
    });

    it('sets channelName to undefined for private chats (DMs have no title)', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'hey',
          chat: { id: 555, type: 'private' },
          from: { id: 100, first_name: 'Alice' },
          message_id: 4,
        },
      });
      expect(input.context?.channelName).toBeUndefined();
    });

    it('produces empty string conversationId when chat.id is null', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'msg',
          chat: { id: null, type: 'group' },
          from: { id: 100 },
          message_id: 1,
        },
      });
      expect(input.conversationId).toBe('');
    });

    it('sets channelId to the stringified chat id', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'msg',
          chat: { id: 12345, type: 'group' },
          from: { id: 100 },
          message_id: 5,
        },
      });
      expect(input.context?.channelId).toBe('12345');
    });
  });

  describe('normalize — mentions', () => {
    it('extracts text_mention entity user ids into context.mentions', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'Hey can you help?',
          chat: { id: 100 },
          from: { id: 200 },
          entities: [
            { type: 'text_mention', user: { id: 42 } },
            { type: 'text_mention', user: { id: 99 } },
          ],
        },
      });
      expect(input.context?.mentions).toEqual(['42', '99']);
    });

    it('sets context.mentions to undefined when no text_mention entities exist', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'plain message',
          chat: { id: 100 },
          from: { id: 200 },
          entities: [{ type: 'mention', offset: 0, length: 5 }], // @username — no user id
        },
      });
      expect(input.context?.mentions).toBeUndefined();
    });

    it('sets context.mentions to undefined when entities array is absent', () => {
      const channel = new TelegramChannel(baseConfig);
      const input = channel.normalize({
        message: {
          text: 'no entities here',
          chat: { id: 100 },
          from: { id: 200 },
        },
      });
      expect(input.context?.mentions).toBeUndefined();
    });
  });
});
