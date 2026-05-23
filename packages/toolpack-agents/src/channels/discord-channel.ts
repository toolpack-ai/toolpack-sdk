import { BaseChannel } from './base-channel.js';
import type { AgentInput, AgentOutput, Participant } from '../agent/types.js';

// ──────────────────────────────────────────────────
// Internal Discord type helpers
// ──────────────────────────────────────────────────

interface DiscordAuthor {
  id: string;
  username: string;
  globalName?: string | null;
  bot?: boolean;
  system?: boolean;
}

interface DiscordChannelInfo {
  type?: number;
  name?: string;
}

interface DiscordThread {
  id: string;
}

/** Minimal shape of a discord.js Message used by this channel. */
interface DiscordMessage {
  id?: string;
  content?: string;
  channelId?: string;
  guildId?: string;
  /** Present on webhook-originated messages; absent on normal user messages. */
  webhookId?: string;
  author?: DiscordAuthor;
  channel?: DiscordChannelInfo;
  thread?: DiscordThread;
}

interface DiscordTextChannel {
  send(options: { content: string }): Promise<unknown>;
}

interface DiscordClientUser {
  tag?: string;
  id?: string;
}

interface DiscordClient {
  user?: DiscordClientUser;
  channels: {
    fetch(id: string): Promise<DiscordTextChannel | null>;
  };
  on(event: string, handler: (...args: unknown[]) => void): void;
  login(token: string): Promise<void>;
  destroy(): Promise<void>;
}

// Discord channel type constants: 1 = DM, 3 = GROUP_DM.
const DM_CHANNEL_TYPES = new Set([1, 3]);

// Matches <@userId> and <@!userId> (nickname mention).
const USER_MENTION_RE = /<@!?(\d+)>/g;

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// ──────────────────────────────────────────────────
// Public config type
// ──────────────────────────────────────────────────

/**
 * Configuration options for DiscordChannel.
 */
export interface DiscordChannelConfig {
  /** Optional name for the channel — required for sendTo() routing. */
  name?: string;

  /** Discord bot token. */
  token: string;

  /**
   * Target guild (server) ID filter.
   * When set, only messages from this guild pass through.
   * DMs (which carry no guildId) are dropped when this is configured.
   * Omit to allow messages from all guilds and DMs.
   */
  guildId?: string;

  /**
   * Target channel ID filter.
   *   - `string`  — only messages in this channel pass through.
   *   - `string[]` — only messages in one of these channels pass through.
   *   - `null` / `undefined` — no channel filter; all channels in the guild pass.
   *
   * Also used as the default destination when send() has no metadata.channelId.
   */
  channelId?: string | string[] | null;

  /**
   * Bot user IDs that are explicitly allowed to pass through.
   * When set, only bots in this list are processed; all other bots are dropped.
   * blockedBotIds takes precedence — a bot in both lists is always dropped.
   * When omitted, ALL bots are dropped by default.
   */
  allowedBotIds?: string[];

  /**
   * Bot user IDs that are explicitly blocked.
   * Checked before allowedBotIds; matching bots are always dropped.
   */
  blockedBotIds?: string[];
}

// ──────────────────────────────────────────────────
// DiscordChannel
// ──────────────────────────────────────────────────

/**
 * DiscordChannel — full-featured Discord bot channel.
 *
 * Capabilities beyond the basic implementation:
 *
 * 1. shouldProcessEvent() — ordered, deterministic filtering:
 *    system/webhook messages → self-suppression → guild filter → channel allowlist
 *    → bot blocklist → bot allowlist → default-drop bots → pass.
 *    All filtering happens in code, not in the LLM prompt.
 *
 * 2. normalize() — extracts @mention user IDs (<@id> and <@!id>) from content
 *    and exposes them as context.mentions (the key the capture interceptor reads
 *    for addressed-only mode). Also sets context.isMentioned when the bot is tagged.
 *
 * 3. resolveParticipant() — fetches richer user info (globalName / avatar) from
 *    the Discord REST API with an in-process per-channel cache.
 *    Call invalidateParticipant(userId) when a `userUpdate` event fires.
 *
 * 4. send() — priority chain: threadId metadata → channelId metadata → first
 *    configured channel → throws if nothing is resolvable.
 *
 * 5. Multi-channel support — channelId accepts string, string[], or null/undefined.
 *
 * 6. Bot self-suppression — botUserId is captured from the `ready` event so our
 *    own echoes are dropped without a separate lookup.
 *
 * 7. userUpdate wiring — participant cache entries are invalidated automatically
 *    when Discord fires a userUpdate event.
 */
export class DiscordChannel extends BaseChannel {
  readonly isTriggerChannel = false;

  protected readonly config: DiscordChannelConfig;

  /** Normalised set of allowed channel IDs (empty = no filter). */
  private readonly allowedChannelIds: ReadonlySet<string>;

  /**
   * The bot's own Discord user ID — populated after the `ready` event.
   *
   * Expose this to agent code for use in `agentAliases` (addressed-only mode):
   * ```ts
   * agentAliases: [discordChannel.botUserId].filter(Boolean) as string[]
   * ```
   */
  botUserId?: string;

  /** In-process participant cache keyed by Discord user ID. */
  private readonly participantCache = new Map<string, Participant>();

  /** discord.js Client instance (populated by listen()). */
  private client?: DiscordClient;

  constructor(config: DiscordChannelConfig) {
    super();
    this.config = config;
    this.name = config.name;

    // Normalise channelId into a Set for O(1) membership checks.
    if (config.channelId == null) {
      this.allowedChannelIds = new Set();
    } else if (Array.isArray(config.channelId)) {
      this.allowedChannelIds = new Set(config.channelId);
    } else {
      this.allowedChannelIds = new Set([config.channelId]);
    }
  }

  // ──────────────────────────────────────────────────
  // Event filtering
  // ──────────────────────────────────────────────────

  /**
   * Deterministic gate applied before any message reaches the LLM.
   *
   * Rules (applied in order; first match wins):
   *   1. No author OR webhook message → drop (system embeds, webhooks).
   *   2. Author is the bot itself → drop (echo suppression).
   *   3. guildId filter configured and message doesn't match → drop (incl. DMs).
   *   4. channelId allowlist configured and message not in it → drop.
   *   5. Author is a bot / system:
   *      a. blockedBotIds matches → drop.
   *      b. allowedBotIds set and not in list → drop.
   *      c. No allowedBotIds → drop all bots by default.
   *   6. All checks passed → process.
   */
  shouldProcessEvent(message: DiscordMessage): boolean {
    // Rule 1: No real author or webhook-originated.
    if (!message.author || message.webhookId) return false;

    // Rule 2: Never process our own messages.
    if (this.botUserId && message.author.id === this.botUserId) return false;

    // Rule 3: Guild filter (DMs have no guildId and are dropped when filter is set).
    if (this.config.guildId && message.guildId !== this.config.guildId) return false;

    // Rule 4: Channel allowlist (skipped when no filter is configured).
    // Also drop messages whose channelId is absent when a filter IS configured —
    // a message with no channel cannot satisfy the allowlist.
    if (this.allowedChannelIds.size > 0) {
      if (!message.channelId || !this.allowedChannelIds.has(message.channelId)) return false;
    }

    // Rule 5: Bot / system message filtering.
    if (message.author.bot || message.author.system) {
      // 5a: Blocked list takes precedence.
      if (this.config.blockedBotIds?.includes(message.author.id)) return false;
      // 5b: Explicit allowlist — only listed bots pass through.
      if (this.config.allowedBotIds) return this.config.allowedBotIds.includes(message.author.id);
      // 5c: Default — drop all bot / system messages.
      return false;
    }

    return true;
  }

  // ──────────────────────────────────────────────────
  // Normalisation
  // ──────────────────────────────────────────────────

  normalize(incoming: unknown): AgentInput {
    const message = incoming as DiscordMessage;

    const rawChannelId = message.channelId;
    // Threads use "channelId:threadId" so thread history is scoped separately
    // from the parent channel.
    const conversationId =
      (rawChannelId ?? '') + (message.thread?.id ? `:${message.thread.id}` : '');

    const discordChannelType = message.channel?.type;
    const isDm = discordChannelType !== undefined && DM_CHANNEL_TYPES.has(discordChannelType);

    const authorId = message.author?.id;
    const authorName = message.author?.globalName ?? message.author?.username;

    // Extract all user IDs mentioned in the message content.
    // Stored as context.mentions (not context.mentionedUserIds) so the capture
    // interceptor's default getMentions() picks them up for addressed-only mode —
    // the same key Slack and Telegram use.
    const mentions: string[] = [];
    if (message.content) {
      USER_MENTION_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = USER_MENTION_RE.exec(message.content)) !== null) {
        mentions.push(match[1]);
      }
    }

    return {
      message: message.content,
      conversationId,
      data: message,
      participant: authorId
        ? { kind: 'user', id: authorId, displayName: authorName ?? undefined }
        : undefined,
      context: {
        userId: authorId,
        username: message.author?.username,
        // 'dm' for DM/group-DM channels so scope resolution returns scope: 'dm'.
        channelType: isDm ? 'dm' : 'channel',
        channelId: rawChannelId,
        channelName: message.channel?.name,
        guildId: message.guildId,
        threadId: message.thread?.id,
        messageId: message.id,
        // @-mentioned user IDs extracted from <@id> and <@!id> tokens.
        // Read by the capture interceptor's default getMentions() and written to
        // StoredMessage.metadata.mentions for addressed-only mode.
        mentions: mentions.length > 0 ? mentions : undefined,
        // Convenience flag: true when the bot itself was @-mentioned.
        // Populated once botUserId is known (after the ready event).
        isMentioned: this.botUserId ? mentions.includes(this.botUserId) : undefined,
      },
    };
  }

  // ──────────────────────────────────────────────────
  // Participant resolution
  // ──────────────────────────────────────────────────

  /**
   * Resolve a richer Participant (with displayName) from the Discord REST API.
   *
   * Successful results are cached in-process for the lifetime of the channel.
   * Call invalidateParticipant(userId) when a `userUpdate` event fires.
   *
   * On API error or network failure, returns a bare `{ kind, id }` participant
   * without caching so the next invocation will retry — matching the behavior
   * of SlackChannel. Never throws.
   */
  async resolveParticipant(input: AgentInput): Promise<Participant | undefined> {
    const userId =
      (input.participant?.id) ?? (input.context?.userId as string | undefined);
    if (!userId) return undefined;

    const cached = this.participantCache.get(userId);
    if (cached) return cached;

    try {
      const res = await fetch(`${DISCORD_API_BASE}/users/${userId}`, {
        headers: { Authorization: `Bot ${this.config.token}` },
      });

      if (!res.ok) {
        console.warn(`[DiscordChannel] Failed to resolve user ${userId}: HTTP ${res.status}`);
        // Return bare id so the pipeline always has something; do not cache so
        // the next message retries the API (matches SlackChannel behavior).
        return { kind: 'user', id: userId };
      }

      const data = (await res.json()) as {
        id: string;
        username: string;
        global_name?: string | null;
        avatar?: string | null;
        discriminator?: string;
      };

      const displayName = data.global_name ?? data.username;
      const participant: Participant = {
        kind: 'user',
        id: data.id,
        displayName,
      };

      this.participantCache.set(userId, participant);
      return participant;
    } catch (err) {
      // Network/parse errors must not crash the pipeline.
      // Return bare id without caching so the next message retries.
      console.warn(`[DiscordChannel] resolveParticipant error for ${userId}:`, err);
      return { kind: 'user', id: userId };
    }
  }

  /**
   * Remove a cached participant entry.
   * Call this when Discord fires a `userUpdate` event so the next interaction
   * fetches fresh data from the API.
   */
  invalidateParticipant(userId: string): void {
    this.participantCache.delete(userId);
  }

  // ──────────────────────────────────────────────────
  // Sending
  // ──────────────────────────────────────────────────

  async send(output: AgentOutput): Promise<void> {
    if (!this.client) {
      throw new Error('[DiscordChannel] Client not initialized. Did you call listen()?');
    }

    // Priority 1: explicit thread from metadata.
    const threadId = output.metadata?.threadId as string | undefined;
    if (threadId) {
      const thread = await this.client.channels.fetch(threadId);
      if (thread && 'send' in thread) {
        try {
          await thread.send({ content: output.output });
          return;
        } catch (error) {
          console.error('[DiscordChannel] Failed to send to thread:', error);
          throw new Error(
            `[DiscordChannel] Failed to send Discord message: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // Thread ID was provided but the channel couldn't be fetched or isn't
      // sendable — log and fall through to the configured channel.
      console.warn(`[DiscordChannel] Thread ${threadId} not found or not sendable; falling back to channel send.`);
    }

    // Priority 2: channel override from metadata.
    // Priority 3: first configured channel ID from the allowlist.
    const resolvedChannelId =
      (output.metadata?.channelId as string | undefined) ??
      (this.allowedChannelIds.size > 0 ? [...this.allowedChannelIds][0] : undefined);

    if (!resolvedChannelId) {
      throw new Error(
        '[DiscordChannel] No channel ID available for sending. ' +
          'Configure channelId or pass output.metadata.channelId.',
      );
    }

    // Fetch the channel first, outside the send try/catch, so a fetch failure
    // or a non-sendable channel produces a clean error without double-wrapping.
    const channel = await this.client.channels.fetch(resolvedChannelId);
    if (!channel || !('send' in channel)) {
      throw new Error(
        `[DiscordChannel] Channel ${resolvedChannelId} not found or is not a text channel`,
      );
    }

    try {
      await channel.send({ content: output.output });
    } catch (error) {
      console.error('[DiscordChannel] Failed to send to channel:', error);
      throw new Error(
        `[DiscordChannel] Failed to send Discord message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────

  listen(): void {
    if (typeof process === 'undefined') return;

    import('discord.js')
      .then((discord) => {
        const { Client, GatewayIntentBits } = discord;

        this.client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
          ],
        }) as unknown as DiscordClient;

        this.client.on('ready', () => {
          const user = (this.client as DiscordClient).user;
          this.botUserId = user?.id;
          const channelDesc =
            this.allowedChannelIds.size === 0
              ? 'all channels'
              : [...this.allowedChannelIds].join(', ');
          const guildDesc = this.config.guildId ?? 'all guilds';
          console.log(
            `[DiscordChannel] Logged in as ${user?.tag ?? 'unknown'} ` +
              `(botUserId=${this.botUserId ?? 'unknown'}) | guild=${guildDesc} | channels=${channelDesc}`,
          );
        });

        this.client.on('messageCreate', (message: unknown) => {
          const msg = message as DiscordMessage;
          if (!this.shouldProcessEvent(msg)) return;
          const input = this.normalize(msg);
          this.handleMessage(input);
        });

        // Invalidate participant cache on user profile updates.
        this.client.on('userUpdate', (_oldUser: unknown, newUser: unknown) => {
          const updated = newUser as DiscordAuthor | undefined;
          if (updated?.id) {
            this.invalidateParticipant(updated.id);
          }
        });

        this.client.login(this.config.token).catch((err: Error) => {
          console.error('[DiscordChannel] Failed to login to Discord:', err);
        });
      })
      .catch((err) => {
        console.error('[DiscordChannel] Failed to initialize Discord client:', err);
        console.error('[DiscordChannel] Make sure discord.js is installed: npm install discord.js');
      });
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = undefined;
    }
  }
}
