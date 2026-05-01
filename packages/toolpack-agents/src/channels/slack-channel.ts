import { createHmac, timingSafeEqual } from 'crypto';
import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput, Participant } from '../agent/types.js';

/**
 * Configuration options for SlackChannel.
 */
export interface SlackChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /**
   * Which Slack channel(s) this instance listens to and replies into.
   *
   * - `string` (e.g. `'#support'` or `'C12345'`) — single channel (back-compat).
   * - `string[]` — multiple channels; inbound events outside this list are dropped.
   * - `null` / omitted — listen to every channel the bot is invited to.
   *
   * **Matching:** compared verbatim against `event.channel` from the Slack payload.
   * Slack events carry channel IDs (`C...`), so pass IDs here for deterministic
   * filtering. If you pass a display name like `'#general'`, it must match the
   * raw string Slack sends — usually an ID, not a name. DMs (`im`/`mpim`) are
   * always accepted regardless of this list.
   *
   * **Outbound:** when sending, `metadata.channelId` (set by `normalize()`) wins.
   * If absent, the fallback is: `string` → itself; `string[]` → first element;
   * `null` → error (must provide `metadata.channelId`).
   */
  channel?: string | string[] | null;

  /** Slack bot token (starts with 'xoxb-') */
  token: string;

  /** Slack app signing secret for request verification */
  signingSecret: string;

  /** Optional port for the HTTP server (default: 3000) */
  port?: number;

  /**
   * Allowlist of bot identities whose Slack messages should be processed when
   * strict mode is desired.
   *
   * Behavior:
   * - Omitted: non-self bot messages are accepted by default (Option B).
   * - Provided (including empty array): only listed bots are accepted.
   *
   * Each entry is matched against **both** `event.bot_id` (a `B...` integration
   * id) and `event.user` (a `U...` user id), since Slack events carry both and
   * developers frequently know one but not the other. Pass whichever you have —
   * typically the peer agent's `SlackChannel.botUserId` (a `U...` value).
   *
   * Note: for normal multi-agent teams you do **not** need to list peers here —
   * non-self bot messages are allowed by default. Use this field only when you
   * want strict, allowlist-only acceptance. To suppress specific noisy bots
   * (e.g. GitHub, CI) while keeping the default-allow behavior, prefer
   * {@link SlackChannelConfig.blockedBotIds}.
   *
   * Example (strict mode): `allowedBotIds: [ramDevAgent.slackChannel.botUserId, 'B_YALINA_BOT']`
   */
  allowedBotIds?: string[];

  /**
   * Blocklist of bot identities that should always be ignored.
   *
   * Matched against both `event.bot_id` (B...) and `event.user` (U...).
   * Takes precedence over `allowedBotIds` and the default allow behavior.
   */
  blockedBotIds?: string[];
}

/**
 * Slack channel for two-way Slack integration.
 * Receives messages from users and replies in-thread.
 */
export class SlackChannel extends BaseChannel {
  readonly isTriggerChannel = false;
  private config: SlackChannelConfig;
  private server?: any; // HTTP server instance

  /**
   * Per-process cache of resolved participants keyed by Slack user id.
   * Populated lazily by `resolveParticipant()`. Invalidated on `user_change`
   * events via `invalidateParticipant()`.
   */
  private participantCache: Map<string, Participant> = new Map();

  /**
   * The bot's Slack user id (e.g. `'U_BOT123'`), populated by the startup
   * self-check (`auth.test`) when `listen()` is called.
   *
   * Pass this to `AssemblerOptions.agentAliases` so the assembler's
   * addressed-only mode can match `<@U_BOT123>` mentions against this agent:
   * ```ts
   * assemblePrompt(store, conversationId, agent.name, agent.name, {
   *   agentAliases: [slackChannel.botUserId].filter(Boolean) as string[],
   * });
   * ```
   */
  botUserId?: string;

  /**
   * Normalized allowlist of channel identifiers, or `null` to accept any channel.
   * Derived from `config.channel` at construction time.
   */
  private allowedChannels: string[] | null;

  constructor(config: SlackChannelConfig) {
    super();
    this.config = {
      port: 3000,
      ...config,
    };
    this.name = config.name;

    // Normalize channel config into a uniform allowlist (or null = any).
    const c = config.channel;
    this.allowedChannels =
      c == null ? null
      : Array.isArray(c) ? c
      : [c];
  }

  /**
   * Start listening for Slack events via HTTP webhook.
   *
   * Performs a startup self-check (`auth.test`) after the server is ready.
   * The bot user id is stored on `this.botUserId` for use in `agentAliases`.
   */
  listen(): void {
    if (typeof process !== 'undefined') {
      import('http').then((http) => {
        this.server = http.createServer((req, res) => {
          this.handleRequest(req, res);
        });

        this.server.listen(this.config.port, () => {
          console.log(`[SlackChannel] Listening on port ${this.config.port}`);
          // Run async — failure is logged but does not prevent the server from serving.
          this.runStartupCheck().catch(() => {});
        });
      }).catch((err) => {
        console.error('[SlackChannel] Failed to start HTTP server:', err);
      });
    }
  }

  /**
   * Calls Slack's `auth.test` API to verify credentials and log the bot's
   * identity. Stores `botUserId` for use in `AssemblerOptions.agentAliases`.
   * Non-fatal — a failed check logs a warning but does not stop the server.
   */
  private async runStartupCheck(): Promise<void> {
    try {
      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json() as {
        ok: boolean;
        user_id?: string;
        user?: string;
        team?: string;
        url?: string;
        error?: string;
      };

      if (data.ok) {
        this.botUserId = data.user_id;
        console.log(
          `[SlackChannel] Connected as @${data.user} (${data.user_id}) ` +
          `in workspace "${data.team}" — ${data.url}`
        );
      } else {
        console.warn(`[SlackChannel] auth.test failed: ${data.error}. Check your bot token.`);
      }
    } catch (err) {
      console.warn('[SlackChannel] Startup self-check failed (network error):', err);
    }
  }

  /**
   * Verify a Slack request signature using HMAC-SHA256.
   *
   * Implements Slack's signing secret verification spec:
   * https://api.slack.com/authentication/verifying-requests-from-slack
   *
   * - Rejects requests with a timestamp older than 5 minutes (replay protection).
   * - Uses `timingSafeEqual` to prevent timing-oracle attacks.
   *
   * Returns `false` for any missing, malformed, or invalid input so that the
   * caller can respond with 401 without leaking which check failed.
   */
  verifySignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): boolean {
    const timestamp = headers['x-slack-request-timestamp'];
    const signature = headers['x-slack-signature'];

    if (!timestamp || !signature || Array.isArray(timestamp) || Array.isArray(signature)) {
      return false;
    }

    // Reject stale or non-numeric timestamps (replay attack prevention).
    // parseInt returns NaN for non-numeric strings; NaN comparisons are always
    // false, which would incorrectly pass the check — guard explicitly.
    const parsedTimestamp = parseInt(timestamp, 10);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (isNaN(parsedTimestamp) || Math.abs(nowSeconds - parsedTimestamp) > 300) {
      return false;
    }

    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const hmac = createHmac('sha256', this.config.signingSecret)
      .update(sigBasestring)
      .digest('hex');
    const computedSig = `v0=${hmac}`;

    // timingSafeEqual requires equal-length buffers; length mismatch means
    // the signature is definitely wrong (avoids the throw and leaks no timing info).
    if (computedSig.length !== signature.length) {
      return false;
    }

    try {
      return timingSafeEqual(Buffer.from(computedSig), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Send a message back to Slack.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    // Post message to Slack using chat.postMessage API
    // Use thread_ts from metadata for threaded replies (conversation continuity)
    // Accept threadTs, thread_ts, or threadId (normalize sets threadId)
    const threadTs =
      (output.metadata?.threadTs as string | undefined) ??
      (output.metadata?.thread_ts as string | undefined) ??
      (output.metadata?.threadId as string | undefined);

    // Resolve target channel. Priority:
    //   1. metadata.channelId (set by normalize via context propagation)
    //   2. First entry of allowedChannels (or the single configured channel)
    //   3. Error — cannot send without a destination.
    const metaChannel = output.metadata?.channelId as string | undefined;
    const targetChannel =
      metaChannel ??
      (this.allowedChannels && this.allowedChannels.length > 0
        ? this.allowedChannels[0]
        : undefined);

    if (!targetChannel) {
      throw new Error(
        '[SlackChannel] Cannot send: no channel configured and metadata.channelId is missing. ' +
        'Provide a target via SlackChannelConfig.channel or output.metadata.channelId.'
      );
    }

    const payload: Record<string, unknown> = {
      channel: targetChannel,
      text: output.output,
    };

    // Reply in thread if thread_ts is available
    if (threadTs) {
      payload.thread_ts = threadTs;
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to send Slack message: ${response.statusText}`);
    }

    const data = await response.json() as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
  }

  /**
   * Normalize a Slack event into AgentInput.
   * @param incoming Slack event payload
   * @returns Normalized AgentInput
   */
  normalize(incoming: unknown): AgentInput {
    const event = incoming as Record<string, unknown>;

    // Extract message text
    const text = (event.text as string) || '';

    // Extract timestamps.
    // thread_ts is present only on replies — it's the parent message ts.
    // ts is always present and identifies this specific message.
    const ts = event.ts as string | undefined;
    const rawThreadTs = event.thread_ts as string | undefined;

    // A message is a threaded reply when thread_ts is present AND differs from ts.
    // Expose this as context.threadId so `defaultGetScope` can detect it.
    const isThreadReply = rawThreadTs !== undefined && rawThreadTs !== ts;

    // Extract user info
    const user = event.user as string | undefined;

    // First-class participant (id-only at this stage; displayName is resolved
    // lazily via `resolveParticipant()` to keep capture cheap).
    const participant: Participant | undefined = user
      ? { kind: 'user', id: user }
      : undefined;

    // Extract @-mention user ids from Slack's `<@UABC123>` tokens in the text.
    // These populate `metadata.mentions` in the capture interceptor so the
    // assembler's addressed-only mode can recognise which agents were addressed.
    const mentionRegex = /<@([A-Z0-9]+)>/g;
    const mentions: string[] = [];
    let mentionMatch: RegExpExecArray | null;
    while ((mentionMatch = mentionRegex.exec(text)) !== null) {
      mentions.push(mentionMatch[1]);
    }

    // For top-level channel/DM messages, conversationId = the channel ID so all
    // messages in a channel are grouped under the same key.
    // For thread replies, conversationId = thread_ts (the parent message ts) so
    // all replies within a thread share one key, independent of the channel.
    const slackChannelId = event.channel as string | undefined;
    const conversationId = isThreadReply
      ? (rawThreadTs as string)
      : (slackChannelId || ts || '');

    return {
      message: text,
      conversationId,
      data: event,
      participant,
      context: {
        user,
        channel: slackChannelId,
        team: event.team as string,
        // Channel_type is 'im' for DMs, 'channel' / 'group' otherwise.
        // Exposed so the address-check interceptor can treat DMs as direct.
        channelType: event.channel_type as string | undefined,
        // Set when this message is a reply inside a thread.
        // Used by defaultGetScope to classify the message as scope: 'thread'.
        threadId: isThreadReply ? rawThreadTs : undefined,
        // @-mentioned user ids extracted from <@UABC123> tokens. Read by
        // the capture interceptor's default getMentions() and written to
        // StoredMessage.metadata.mentions for addressed-only mode.
        mentions: mentions.length > 0 ? mentions : undefined,
        // Platform channel id — always the Slack channel, even for threads
        // (where conversationId is the thread root ts, not the channel id).
        channelId: slackChannelId,
        // Human-readable channel label. Prefer the configured value when the
        // channel is pinned to a single string (classic single-room setup), since
        // that is usually a friendly name like '#general'. For multi-channel or
        // listen-everywhere configs, fall back to the event's channel id since
        // we have no deterministic friendly label without an extra API call.
        channelName:
          typeof this.config.channel === 'string'
            ? this.config.channel
            : slackChannelId,
      },
    };
  }

  /**
   * Resolve a richer `Participant` (with `displayName`) for a normalized input.
   *
   * Uses Slack's `users.info` API and an in-process cache. Returns `undefined`
   * if the input has no user id or if the lookup fails; callers fall back to
   * the bare id. Never throws.
   *
   * Cache invalidation is handled externally via `invalidateParticipant()`,
   * typically wired to the Slack `user_change` event.
   */
  async resolveParticipant(input: AgentInput): Promise<Participant | undefined> {
    const userId = input.participant?.id ?? (input.context?.user as string | undefined);
    if (!userId) return undefined;

    // Return cached copy if we've resolved this user before.
    const cached = this.participantCache.get(userId);
    if (cached) return cached;

    try {
      const response = await fetch(
        `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.config.token}` },
        }
      );
      if (!response.ok) return { kind: 'user', id: userId };

      const data = (await response.json()) as {
        ok: boolean;
        user?: {
          name?: string;
          real_name?: string;
          profile?: { display_name?: string; real_name?: string };
        };
      };

      if (!data.ok || !data.user) {
        const fallback: Participant = { kind: 'user', id: userId };
        this.participantCache.set(userId, fallback);
        return fallback;
      }

      const displayName =
        data.user.profile?.display_name ||
        data.user.profile?.real_name ||
        data.user.real_name ||
        data.user.name ||
        userId;

      const participant: Participant = {
        kind: 'user',
        id: userId,
        displayName,
        metadata: { slackUser: data.user },
      };
      this.participantCache.set(userId, participant);
      return participant;
    } catch {
      // Network/parse errors must not crash the pipeline.
      return { kind: 'user', id: userId };
    }
  }

  /**
   * Invalidate a cached participant. Call this from a `user_change`
   * Slack event handler to force a refresh on the next lookup.
   */
  invalidateParticipant(userId: string): void {
    this.participantCache.delete(userId);
  }

  /**
   * Decide whether an incoming Slack event should be normalised and dispatched
   * to the agent.
   *
   * Rules, applied in order:
   * 1. Only `message` and `app_mention` events are processed; others are dropped.
   * 2. Channel allowlist (from `config.channel`): events outside the allowlist
   *    are dropped. DMs (`im`/`mpim`) always pass because they are per-user, not
   *    per-channel. Skipped entirely when `config.channel` is null/omitted.
   * 3. **Self-suppression (automatic):** events where `event.user` matches this
   *    channel's own `botUserId` are dropped. This prevents agents from looping
   *    on their own posts and requires no configuration — `botUserId` is
   *    discovered via `auth.test` at startup.
   * 4. Events without `bot_id` (human messages) pass.
   * 5. Explicit blocklist check (`blockedBotIds`) runs first for bot messages.
   * 6. If `allowedBotIds` is provided, strict mode applies: only listed bots
   *    pass (matched against both `bot_id` and `user`).
   * 7. If `allowedBotIds` is omitted, other bot messages pass by default.
   *
   * Exposed for direct unit testing; not intended as a public API.
   */
  shouldProcessEvent(event: Record<string, unknown>): boolean {
    const type = event.type as string | undefined;
    if (type !== 'message' && type !== 'app_mention') return false;

    // Channel allowlist filter. DMs (`im`/`mpim`) always pass because they
    // are conceptually per-user, not per-channel.
    if (this.allowedChannels !== null) {
      const channelType = event.channel_type as string | undefined;
      const isDM = channelType === 'im' || channelType === 'mpim';
      if (!isDM) {
        const eventChannel = event.channel as string | undefined;
        if (!eventChannel || !this.allowedChannels.includes(eventChannel)) {
          return false;
        }
      }
    }

    const userId = event.user as string | undefined;

    // Precise self-suppression: drop events originating from this bot's own
    // user id. Prevents self-reply loops without needing any config entry.
    if (this.botUserId && userId === this.botUserId) {
      return false;
    }

    const botId = event.bot_id as string | undefined;
    if (!botId) return true;

    const blockedList = this.config.blockedBotIds ?? [];
    if (
      blockedList.includes(botId) ||
      (userId !== undefined && blockedList.includes(userId))
    ) {
      return false;
    }

    // Strict mode when allowlist is explicitly provided.
    if (this.config.allowedBotIds !== undefined) {
      const allowedList = this.config.allowedBotIds;
      return (
        allowedList.includes(botId) ||
        (userId !== undefined && allowedList.includes(userId))
      );
    }

    // Default mode (Option B): accept non-self bot messages unless blocked.
    return true;
  }

  /**
   * Handle incoming HTTP requests from Slack.
   */
  private handleRequest(req: any, res: any): void {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      // Verify the request is genuinely from Slack before processing.
      if (!this.verifySignature(req.headers, body)) {
        res.writeHead(401);
        res.end('Invalid signature');
        return;
      }

      try {
        const payload = JSON.parse(body);

        // Handle URL verification challenge
        if (payload.type === 'url_verification') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ challenge: payload.challenge }));
          return;
        }

        // Handle event callbacks
        if (payload.type === 'event_callback' && payload.event) {
          const event = payload.event;

          // Apply inbound filters (event type, channel, self-suppression, bot policy).
          // See shouldProcessEvent() for the full rule set.
          if (this.shouldProcessEvent(event)) {
            const input = this.normalize(event);
            this.handleMessage(input);
          } else if (event.type === 'user_change' && event.user) {
            // Invalidate cached participant so the next lookup fetches fresh display-name.
            this.invalidateParticipant((event.user as Record<string, unknown>).id as string);
          }

          res.writeHead(200);
          res.end('OK');
          return;
        }

        res.writeHead(200);
        res.end('OK');
      } catch (error) {
        console.error('[SlackChannel] Error handling request:', error);
        res.writeHead(400);
        res.end('Bad request');
      }
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }
}
