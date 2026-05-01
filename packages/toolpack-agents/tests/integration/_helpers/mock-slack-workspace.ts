import { BaseChannel } from '../../../src/channels/base-channel.js';
import type { AgentInput, AgentOutput } from '../../../src/agent/types.js';

export interface PostRecord {
  agentName: string;
  channelId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * A lightweight mock Slack channel that:
 * - Skips HTTP server creation (listen is a no-op)
 * - Accepts events via dispatchEvent()
 * - Captures outbound sends into MockSlackWorkspace.posts
 * - Replicates SlackChannel's channel-allowlist filtering
 */
export class MockSlackChannel extends BaseChannel {
  readonly isTriggerChannel = false;

  private workspace: MockSlackWorkspace;
  private allowedChannels: string[] | null;

  constructor(
    workspace: MockSlackWorkspace,
    allowedChannels: string[] | null,
    name?: string,
  ) {
    super();
    this.workspace = workspace;
    this.allowedChannels = allowedChannels;
    this.name = name;
  }

  listen(): void {}

  async send(output: AgentOutput): Promise<void> {
    const meta = output.metadata as Record<string, unknown> | undefined;
    const channelId =
      (meta?.channelId as string | undefined) ??
      this.allowedChannels?.[0] ??
      'unknown';

    this.workspace.capturePost({
      agentName: this.name ?? 'unknown',
      channelId,
      text: output.output,
      metadata: meta,
    });
  }

  normalize(incoming: unknown): AgentInput {
    const ev = incoming as Record<string, unknown>;
    const channelId = ev.channel as string | undefined;
    const userId = ev.user as string | undefined;
    const text = (ev.text as string | undefined) ?? '';
    const channelType = ev.channel_type as string | undefined;

    return {
      message: text,
      conversationId: channelId ?? '',
      participant: userId ? { kind: 'user', id: userId } : undefined,
      context: {
        user: userId,
        channel: channelId,
        channelId,
        channelType,
      },
    };
  }

  /** Mirror of SlackChannel.shouldProcessEvent (channel-allowlist + DM pass-through). */
  shouldProcessEvent(ev: Record<string, unknown>): boolean {
    if (this.allowedChannels !== null) {
      const channelType = ev.channel_type as string | undefined;
      const isDM = channelType === 'im' || channelType === 'mpim';
      if (!isDM) {
        const ch = ev.channel as string | undefined;
        if (!ch || !this.allowedChannels.includes(ch)) return false;
      }
    }
    return true;
  }

  /** Inject a Slack-like event directly into this channel. */
  async dispatchEvent(ev: Record<string, unknown>): Promise<void> {
    if (this.shouldProcessEvent(ev)) {
      await this.handleMessage(this.normalize(ev));
    }
  }
}

/**
 * Simulates a Slack workspace for integration testing.
 *
 * Usage:
 *   const ws = new MockSlackWorkspace();
 *   const ch = ws.createChannel('strategist-slack', ['#team', '#general'], 'strategist-slack');
 *   await ws.postFromHuman('#team', 'U_HUMAN', 'Hello @strategist');
 *   ws.posts  // captured outbound messages
 */
export class MockSlackWorkspace {
  posts: PostRecord[] = [];
  private channels: MockSlackChannel[] = [];

  /** Create a MockSlackChannel and register it with this workspace. */
  createChannel(
    allowedChannels: string[] | null,
    name?: string,
  ): MockSlackChannel {
    const ch = new MockSlackChannel(this, allowedChannels, name);
    this.channels.push(ch);
    return ch;
  }

  capturePost(record: PostRecord): void {
    this.posts.push(record);
  }

  /** Broadcast a human message to every channel that accepts it. */
  async postFromHuman(
    channelId: string,
    userId: string,
    text: string,
  ): Promise<void> {
    const ev = {
      type: 'message',
      channel: channelId,
      channel_type: 'channel',
      user: userId,
      text,
      ts: String(Date.now() / 1000),
    };
    for (const ch of this.channels) {
      await ch.dispatchEvent(ev);
    }
  }

  /** Broadcast a DM to every channel that accepts DMs (channel_type: 'im'). */
  async postDM(
    dmChannelId: string,
    userId: string,
    text: string,
  ): Promise<void> {
    const ev = {
      type: 'message',
      channel: dmChannelId,
      channel_type: 'im',
      user: userId,
      text,
      ts: String(Date.now() / 1000),
    };
    for (const ch of this.channels) {
      await ch.dispatchEvent(ev);
    }
  }

  /** Posts captured for a specific channelId. */
  visiblePosts(channelId: string): PostRecord[] {
    return this.posts.filter(p => p.channelId === channelId);
  }

  /** Posts captured from a specific agent. */
  postsFrom(agentName: string): PostRecord[] {
    return this.posts.filter(p => p.agentName === agentName);
  }

  reset(): void {
    this.posts = [];
  }
}
