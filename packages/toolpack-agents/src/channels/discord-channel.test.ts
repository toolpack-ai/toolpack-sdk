import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DiscordChannel } from './discord-channel.js';

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function makeChannel(overrides: Partial<ConstructorParameters<typeof DiscordChannel>[0]> = {}) {
  return new DiscordChannel({
    name: 'test-discord',
    token: 'discord-bot-token',
    guildId: '123456789',
    channelId: '987654321',
    ...overrides,
  });
}

/** Minimal valid user message fixture. */
function userMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg1',
    content: 'Hello',
    channelId: '987654321',
    guildId: '123456789',
    author: { id: 'u1', username: 'alice', bot: false },
    channel: { type: 0, name: 'general' },
    ...overrides,
  };
}

// ──────────────────────────────────────────────────
// Basic configuration
// ──────────────────────────────────────────────────

describe('DiscordChannel — configuration', () => {
  it('stores name and isTriggerChannel', () => {
    const channel = makeChannel();
    expect(channel.name).toBe('test-discord');
    expect(channel.isTriggerChannel).toBe(false);
  });

  it('does not throw on listen()', () => {
    const channel = makeChannel();
    expect(() => channel.listen()).not.toThrow();
  });

  it('exposes botUserId as a public property (undefined before ready)', () => {
    const channel = makeChannel();
    // Public — accessible without type errors, undefined before the ready event fires.
    expect(channel.botUserId).toBeUndefined();
  });

  it('accepts multi-channel array for channelId', () => {
    const channel = makeChannel({ channelId: ['ch1', 'ch2'] });
    expect(channel).toBeDefined();
  });

  it('accepts null channelId (no filter)', () => {
    const channel = makeChannel({ channelId: null });
    expect(channel).toBeDefined();
  });

  it('accepts undefined guildId', () => {
    const channel = makeChannel({ guildId: undefined });
    expect(channel).toBeDefined();
  });
});

// ──────────────────────────────────────────────────
// normalize()
// ──────────────────────────────────────────────────

describe('DiscordChannel — normalize()', () => {
  let channel: DiscordChannel;

  beforeEach(() => {
    channel = makeChannel();
  });

  it('maps basic message fields', () => {
    const input = channel.normalize(
      userMessage({ content: 'Hello from Discord', channelId: '987654321', id: 'msg123' }),
    );
    expect(input.message).toBe('Hello from Discord');
    expect(input.conversationId).toBe('987654321');
    expect(input.context?.userId).toBe('u1');
    expect(input.context?.username).toBe('alice');
    expect(input.context?.channelId).toBe('987654321');
  });

  it('appends thread id to conversationId', () => {
    const input = channel.normalize(
      userMessage({ thread: { id: 'thread123' } }),
    );
    expect(input.conversationId).toBe('987654321:thread123');
    expect(input.context?.threadId).toBe('thread123');
  });

  it('keeps context.channelId as bare channel ID for threaded messages', () => {
    const input = channel.normalize(userMessage({ thread: { id: 'thread123' } }));
    expect(input.context?.channelId).toBe('987654321');
  });

  it('produces empty conversationId when message.channelId is absent', () => {
    const input = channel.normalize({ content: 'Hello', id: 'msg1', author: { id: 'u1', username: 'alice' } });
    expect(input.conversationId).toBe('');
    expect(input.context?.channelId).toBeUndefined();
  });

  it('populates participant using globalName', () => {
    const input = channel.normalize(
      userMessage({ author: { id: 'u1', username: 'alice', globalName: 'Alice Real' } }),
    );
    expect(input.participant).toEqual({ kind: 'user', id: 'u1', displayName: 'Alice Real' });
  });

  it('falls back to username when globalName is absent', () => {
    const input = channel.normalize(userMessage({ author: { id: 'u1', username: 'alice' } }));
    expect(input.participant).toEqual({ kind: 'user', id: 'u1', displayName: 'alice' });
  });

  it('sets participant to undefined when author is absent', () => {
    const input = channel.normalize({ content: 'System message', channelId: '987654321', id: 'msg1' });
    expect(input.participant).toBeUndefined();
  });

  it('sets channelType to "dm" for DM channels (type 1)', () => {
    const input = channel.normalize(userMessage({ channel: { type: 1 } }));
    expect(input.context?.channelType).toBe('dm');
  });

  it('sets channelType to "dm" for Group DM channels (type 3)', () => {
    const input = channel.normalize(userMessage({ channel: { type: 3 } }));
    expect(input.context?.channelType).toBe('dm');
  });

  it('sets channelType to "channel" for guild text channels (type 0)', () => {
    const input = channel.normalize(userMessage({ channel: { type: 0, name: 'general' } }));
    expect(input.context?.channelType).toBe('channel');
  });

  it('sets channelName from channel.name', () => {
    const input = channel.normalize(userMessage({ channel: { type: 0, name: 'general' } }));
    expect(input.context?.channelName).toBe('general');
  });

  it('sets channelName to undefined for DM (no name)', () => {
    const input = channel.normalize(userMessage({ channel: { type: 1 } }));
    expect(input.context?.channelName).toBeUndefined();
  });

  // @mention extraction
  it('extracts mentioned user IDs into context.mentions (capture-interceptor key)', () => {
    const input = channel.normalize(
      userMessage({ content: 'Hey <@123456> and <@!456789>, look at this' }),
    );
    // Must be context.mentions (not mentionedUserIds) so the capture
    // interceptor's default getMentions() picks them up for addressed-only mode.
    expect(input.context?.mentions).toEqual(['123456', '456789']);
  });

  it('sets context.mentions to undefined when no mentions present', () => {
    const input = channel.normalize(userMessage({ content: 'No mentions here' }));
    expect(input.context?.mentions).toBeUndefined();
  });

  it('does not include role or channel mentions in context.mentions', () => {
    // Role mentions use <@&id>, channel mentions use <#id> — neither matches <@!?\d+>
    const input = channel.normalize(
      userMessage({ content: '<@&999001> and <#888002> but <@789012>' }),
    );
    expect(input.context?.mentions).toEqual(['789012']);
  });

  it('sets isMentioned to true when the bot itself is @-mentioned', () => {
    channel['botUserId'] = '111222333';
    const input = channel.normalize(
      userMessage({ content: 'Hey <@111222333> check this out' }),
    );
    expect(input.context?.isMentioned).toBe(true);
  });

  it('sets isMentioned to false when bot is not mentioned', () => {
    channel['botUserId'] = '111222333';
    const input = channel.normalize(
      userMessage({ content: 'Hey <@999888777> check this out' }),
    );
    expect(input.context?.isMentioned).toBe(false);
  });

  it('sets isMentioned to undefined when botUserId is not yet known (before ready)', () => {
    // botUserId is undefined before the ready event fires
    const input = channel.normalize(
      userMessage({ content: 'Hey <@123456>' }),
    );
    expect(input.context?.isMentioned).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────
// shouldProcessEvent()
// ──────────────────────────────────────────────────

describe('DiscordChannel — shouldProcessEvent()', () => {
  // ── Rule 1: system / webhook messages ────────────
  it('drops messages with no author', () => {
    const channel = makeChannel();
    expect(channel.shouldProcessEvent({ content: 'system' })).toBe(false);
  });

  it('drops webhook messages (webhookId set)', () => {
    const channel = makeChannel();
    expect(
      channel.shouldProcessEvent(
        userMessage({ webhookId: 'wh123' }),
      ),
    ).toBe(false);
  });

  // ── Rule 2: self-suppression ──────────────────────
  it('drops messages from the bot itself (botUserId match)', () => {
    const channel = makeChannel() as unknown as { botUserId: string } & DiscordChannel;
    channel['botUserId'] = 'BOT_ID';
    expect(
      channel.shouldProcessEvent(
        userMessage({ author: { id: 'BOT_ID', username: 'mybot', bot: true } }),
      ),
    ).toBe(false);
  });

  it('passes messages from a different user when botUserId is set', () => {
    const channel = makeChannel();
    channel['botUserId'] = 'BOT_ID';
    expect(channel.shouldProcessEvent(userMessage({ author: { id: 'u1', username: 'alice' } }))).toBe(true);
  });

  // ── Rule 3: guild filter ─────────────────────────
  it('drops messages from a different guild', () => {
    const channel = makeChannel({ guildId: '123456789' });
    expect(channel.shouldProcessEvent(userMessage({ guildId: '999999' }))).toBe(false);
  });

  it('drops DMs when guildId is configured (no guildId on DM message)', () => {
    const channel = makeChannel({ guildId: '123456789' });
    const dm = { ...userMessage(), guildId: undefined };
    expect(channel.shouldProcessEvent(dm)).toBe(false);
  });

  it('passes messages from the configured guild', () => {
    const channel = makeChannel({ guildId: '123456789' });
    expect(channel.shouldProcessEvent(userMessage({ guildId: '123456789' }))).toBe(true);
  });

  it('passes all guilds and DMs when guildId is not configured', () => {
    const channel = makeChannel({ guildId: undefined });
    expect(channel.shouldProcessEvent(userMessage({ guildId: 'ANY_GUILD' }))).toBe(true);
  });

  // ── Rule 4: channel allowlist ─────────────────────
  it('drops messages from a channel not in the allowlist', () => {
    const channel = makeChannel({ channelId: '987654321' });
    expect(channel.shouldProcessEvent(userMessage({ channelId: 'OTHER_CH' }))).toBe(false);
  });

  it('passes messages in the configured channel', () => {
    const channel = makeChannel({ channelId: '987654321' });
    expect(channel.shouldProcessEvent(userMessage({ channelId: '987654321' }))).toBe(true);
  });

  it('passes any channel when channelId is null', () => {
    const channel = makeChannel({ channelId: null });
    expect(channel.shouldProcessEvent(userMessage({ channelId: 'ANY_CHANNEL' }))).toBe(true);
  });

  it('drops messages with no channelId when a channel filter is configured', () => {
    const channel = makeChannel({ channelId: '987654321' });
    const msg = { ...userMessage(), channelId: undefined };
    expect(channel.shouldProcessEvent(msg)).toBe(false);
  });

  it('accepts multi-channel array — passes when channelId is in list', () => {
    const channel = makeChannel({ channelId: ['ch1', 'ch2'], guildId: undefined });
    expect(channel.shouldProcessEvent(userMessage({ channelId: 'ch2', guildId: undefined }))).toBe(true);
  });

  it('accepts multi-channel array — drops when channelId is not in list', () => {
    const channel = makeChannel({ channelId: ['ch1', 'ch2'], guildId: undefined });
    expect(channel.shouldProcessEvent(userMessage({ channelId: 'ch3', guildId: undefined }))).toBe(false);
  });

  // ── Rule 5: bot filtering ─────────────────────────
  it('drops bot messages by default (no allowedBotIds)', () => {
    const channel = makeChannel();
    expect(
      channel.shouldProcessEvent(
        userMessage({ author: { id: 'bot1', username: 'SomeBot', bot: true } }),
      ),
    ).toBe(false);
  });

  it('drops bot in blockedBotIds even if also in allowedBotIds', () => {
    const channel = makeChannel({
      blockedBotIds: ['bot1'],
      allowedBotIds: ['bot1'],
    });
    expect(
      channel.shouldProcessEvent(
        userMessage({ author: { id: 'bot1', username: 'SomeBot', bot: true } }),
      ),
    ).toBe(false);
  });

  it('passes bot in allowedBotIds (not blocked)', () => {
    const channel = makeChannel({ allowedBotIds: ['bot1'] });
    expect(
      channel.shouldProcessEvent(
        userMessage({ author: { id: 'bot1', username: 'SomeBot', bot: true } }),
      ),
    ).toBe(true);
  });

  it('drops bot not in allowedBotIds when allowedBotIds is configured', () => {
    const channel = makeChannel({ allowedBotIds: ['bot1'] });
    expect(
      channel.shouldProcessEvent(
        userMessage({ author: { id: 'bot2', username: 'OtherBot', bot: true } }),
      ),
    ).toBe(false);
  });

  it('drops system messages (author.system = true)', () => {
    const channel = makeChannel();
    expect(
      channel.shouldProcessEvent(
        userMessage({ author: { id: 's1', username: 'system', system: true } }),
      ),
    ).toBe(false);
  });

  // ── Normal user pass-through ──────────────────────
  it('passes a normal user message through all rules', () => {
    const channel = makeChannel();
    expect(channel.shouldProcessEvent(userMessage())).toBe(true);
  });
});

// ──────────────────────────────────────────────────
// resolveParticipant()
// ──────────────────────────────────────────────────

describe('DiscordChannel — resolveParticipant()', () => {
  let channel: DiscordChannel;

  beforeEach(() => {
    channel = makeChannel();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when userId is absent', async () => {
    const result = await channel.resolveParticipant({ message: 'hello', context: {} });
    expect(result).toBeUndefined();
  });

  it('fetches user from Discord REST API and caches the result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'u1', username: 'alice', global_name: 'Alice Real' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const input = { message: 'hi', context: { userId: 'u1' } };

    const first = await channel.resolveParticipant(input);
    expect(first).toEqual({ kind: 'user', id: 'u1', displayName: 'Alice Real' });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call should use cache — no extra fetch.
    const second = await channel.resolveParticipant(input);
    expect(second).toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to username when global_name is absent (undefined)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'u1', username: 'alice' }),
    }));

    const result = await channel.resolveParticipant({ message: 'hi', context: { userId: 'u1' } });
    expect(result?.displayName).toBe('alice');
  });

  it('falls back to username when global_name is null (real Discord API behavior)', async () => {
    // Discord REST API sends null (not undefined) for global_name when not set.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'u1', username: 'alice', global_name: null }),
    }));

    const result = await channel.resolveParticipant({ message: 'hi', context: { userId: 'u1' } });
    expect(result?.displayName).toBe('alice');
  });

  it('returns bare-id participant (not undefined) on API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await channel.resolveParticipant({ message: 'hi', context: { userId: 'u1' } });
    expect(result).toEqual({ kind: 'user', id: 'u1' });
  });

  it('does not cache failure — retries on next call (matches SlackChannel behavior)', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'u1', username: 'alice', global_name: 'Alice' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const input = { message: 'hi', context: { userId: 'u1' } };
    const first = await channel.resolveParticipant(input);
    expect(first).toEqual({ kind: 'user', id: 'u1' }); // bare-id fallback

    // Second call should retry (not served from cache) and succeed.
    const second = await channel.resolveParticipant(input);
    expect(second?.displayName).toBe('Alice');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns bare-id participant (not undefined) on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await channel.resolveParticipant({ message: 'hi', context: { userId: 'u1' } });
    expect(result).toEqual({ kind: 'user', id: 'u1' });
  });

  it('resolves userId from input.participant.id when context.userId is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'u1', username: 'alice', global_name: 'Alice' }),
    }));

    const result = await channel.resolveParticipant({
      message: 'hi',
      participant: { kind: 'user', id: 'u1' },
      context: {},
    });
    expect(result?.id).toBe('u1');
  });

  it('refetches after invalidateParticipant()', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'u1', username: 'alice' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const input = { message: 'hi', context: { userId: 'u1' } };
    await channel.resolveParticipant(input);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    channel.invalidateParticipant('u1');

    await channel.resolveParticipant(input);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
