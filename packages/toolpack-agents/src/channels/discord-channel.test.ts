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

  it('keeps context.channelId as bare channel ID for threaded messages', () => {
    const message = {
      content: 'Thread reply',
      channelId: '987654321',
      id: 'msg123',
      thread: { id: 'thread123' },
      author: { id: 'user123', username: 'testuser' },
    };

    const input = channel.normalize(message);

    expect(input.conversationId).toBe('987654321:thread123');
    expect(input.context?.channelId).toBe('987654321');
  });

  it('produces empty string conversationId when message.channelId is absent', () => {
    const message = {
      content: 'Hello',
      id: 'msg1',
      author: { id: 'u1', username: 'alice' },
    };

    const input = channel.normalize(message);

    expect(input.conversationId).toBe('');
    expect(input.context?.channelId).toBeUndefined();
  });

  it('populates participant from message.author', () => {
    const message = {
      content: 'Hello',
      channelId: '987654321',
      id: 'msg1',
      author: { id: 'u1', username: 'alice', globalName: 'Alice' },
    };

    const input = channel.normalize(message);

    expect(input.participant).toEqual({ kind: 'user', id: 'u1', displayName: 'Alice' });
  });

  it('uses username as displayName when globalName is absent', () => {
    const message = {
      content: 'Hello',
      channelId: '987654321',
      id: 'msg1',
      author: { id: 'u1', username: 'alice' },
    };

    const input = channel.normalize(message);

    expect(input.participant).toEqual({ kind: 'user', id: 'u1', displayName: 'alice' });
  });

  it('sets participant to undefined when author is absent (webhook/system message)', () => {
    const message = {
      content: 'System message',
      channelId: '987654321',
      id: 'msg1',
    };

    const input = channel.normalize(message);

    expect(input.participant).toBeUndefined();
  });

  it('sets channelType to "dm" for DM channels (type 1)', () => {
    const message = {
      content: 'DM',
      channelId: '987654321',
      id: 'msg1',
      channel: { type: 1, name: undefined },
      author: { id: 'u1', username: 'alice' },
    };

    const input = channel.normalize(message);

    expect(input.context?.channelType).toBe('dm');
  });

  it('sets channelType to "dm" for Group DM channels (type 3)', () => {
    const message = {
      content: 'Group DM',
      channelId: '987654321',
      id: 'msg1',
      channel: { type: 3 },
      author: { id: 'u1', username: 'alice' },
    };

    const input = channel.normalize(message);

    expect(input.context?.channelType).toBe('dm');
  });

  it('sets channelType to "channel" for guild text channels', () => {
    const message = {
      content: 'Hello',
      channelId: '987654321',
      id: 'msg1',
      channel: { type: 0, name: 'general' },
      author: { id: 'u1', username: 'alice' },
    };

    const input = channel.normalize(message);

    expect(input.context?.channelType).toBe('channel');
  });

  it('sets channelName from channel.name', () => {
    const message = {
      content: 'Hello',
      channelId: '987654321',
      id: 'msg1',
      channel: { type: 0, name: 'general' },
      author: { id: 'u1', username: 'alice' },
    };

    const input = channel.normalize(message);

    expect(input.context?.channelName).toBe('general');
  });

  it('sets channelName to undefined when channel.name is absent (DM)', () => {
    const message = {
      content: 'DM',
      channelId: '987654321',
      id: 'msg1',
      channel: { type: 1 },
      author: { id: 'u1', username: 'alice' },
    };

    const input = channel.normalize(message);

    expect(input.context?.channelName).toBeUndefined();
  });

  it('should initialize without errors', () => {
    expect(() => channel.listen()).not.toThrow();
  });
});
