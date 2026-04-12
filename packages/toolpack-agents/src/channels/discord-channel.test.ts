import { describe, it, expect, beforeEach } from 'vitest';
import { DiscordChannel } from './discord-channel.js';

describe('DiscordChannel', () => {
  let channel: DiscordChannel;

  beforeEach(() => {
    channel = new DiscordChannel({
      name: 'test-discord',
      token: 'discord-bot-token',
      guildId: '123456789',
      channelId: '987654321',
    });
  });

  it('should have correct configuration', () => {
    expect(channel.name).toBe('test-discord');
    expect(channel.isTriggerChannel).toBe(false);
  });

  it('should not be a trigger channel (supports two-way)', () => {
    expect(channel.isTriggerChannel).toBe(false);
  });

  it('should normalize Discord message', () => {
    const message = {
      content: 'Hello from Discord',
      channelId: '987654321',
      guildId: '123456789',
      id: 'msg123',
      author: {
        id: 'user123',
        username: 'testuser',
        bot: false,
      },
    };

    const input = channel.normalize(message);

    expect(input.message).toBe('Hello from Discord');
    expect(input.conversationId).toBe('987654321');
    expect(input.context?.userId).toBe('user123');
    expect(input.context?.username).toBe('testuser');
    expect(input.context?.channelId).toBe('987654321');
  });

  it('should normalize Discord message with thread', () => {
    const message = {
      content: 'Hello from thread',
      channelId: '987654321',
      guildId: '123456789',
      id: 'msg123',
      thread: {
        id: 'thread123',
      },
      author: {
        id: 'user123',
        username: 'testuser',
        bot: false,
      },
    };

    const input = channel.normalize(message);

    expect(input.conversationId).toBe('987654321:thread123');
    expect(input.context?.threadId).toBe('thread123');
  });

  it('should initialize without errors', () => {
    expect(() => channel.listen()).not.toThrow();
  });
});
