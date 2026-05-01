import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

/**
 * Configuration options for DiscordChannel.
 */
export interface DiscordChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** Discord bot token */
  token: string;

  /** Target guild (server) ID */
  guildId: string;

  /** Target channel ID */
  channelId: string;
}

/**
 * Discord channel for two-way Discord bot integration.
 * Receives messages from guild channels or DMs and replies in-thread.
 */
export class DiscordChannel extends BaseChannel {
  readonly isTriggerChannel = false;
  private config: DiscordChannelConfig;
  private client?: any;

  constructor(config: DiscordChannelConfig) {
    super();
    this.config = config;
    this.name = config.name;
  }

  /**
   * Start listening for Discord messages.
   */
  listen(): void {
    if (typeof process !== 'undefined') {
      import('discord.js').then((discord) => {
        const { Client, GatewayIntentBits } = discord;

        this.client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
          ],
        });

        this.client.on('ready', () => {
          console.log(`[DiscordChannel] Bot logged in as ${this.client.user?.tag}`);
        });

        this.client.on('messageCreate', (message: any) => {
          this.handleDiscordMessage(message);
        });

        this.client.login(this.config.token).catch((err: Error) => {
          console.error('[DiscordChannel] Failed to login to Discord:', err);
        });
      }).catch((err) => {
        console.error('[DiscordChannel] Failed to initialize Discord client:', err);
        console.error('[DiscordChannel] Make sure to install discord.js: npm install discord.js');
      });
    }
  }

  /**
   * Send a message to Discord.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    if (!this.client) {
      throw new Error('Discord client not initialized. Did you call listen()?');
    }

    try {
      const channelId = (output.metadata?.channelId as string) || this.config.channelId;
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        throw new Error(`Channel ${channelId} not found or is not a text channel`);
      }

      const messageOptions: any = {
        content: output.output,
      };

      const threadId = output.metadata?.threadId as string | undefined;
      if (threadId) {
        const thread = await this.client.channels.fetch(threadId);
        if (thread && 'send' in thread) {
          await thread.send(messageOptions);
          return;
        }
      }

      await channel.send(messageOptions);
    } catch (error) {
      console.error('[DiscordChannel] Failed to send Discord message:', error);
      throw new Error(`Failed to send Discord message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Normalize a Discord message into AgentInput.
   * @param incoming Discord message object
   * @returns Normalized AgentInput
   */
  normalize(incoming: unknown): AgentInput {
    const message = incoming as Record<string, any>;

    // Threads use "channelId:threadId" so thread history is scoped separately
    // from the parent channel.
    const rawChannelId = message.channelId as string | undefined;
    const conversationId = (rawChannelId ?? '') + (message.thread?.id ? `:${message.thread.id}` : '');

    // Discord channel type constants: 1 = DM, 3 = GROUP_DM.
    const discordChannelType = message.channel?.type as number | undefined;
    const isDm = discordChannelType === 1 || discordChannelType === 3;

    const authorId = message.author?.id as string | undefined;
    const authorName = (message.author?.globalName as string | undefined)
      || (message.author?.username as string | undefined);

    return {
      message: message.content,
      conversationId,
      data: message,
      participant: authorId
        ? { kind: 'user', id: authorId, displayName: authorName }
        : undefined,
      context: {
        userId: authorId,
        username: message.author?.username,
        // 'dm' for DM/group-DM channels so defaultGetScope returns scope: 'dm'.
        channelType: isDm ? 'dm' : 'channel',
        channelId: rawChannelId,
        channelName: message.channel?.name as string | undefined,
        guildId: message.guildId,
        threadId: message.thread?.id,
        messageId: message.id,
      },
    };
  }

  /**
   * Handle incoming Discord messages.
   */
  private handleDiscordMessage(message: any): void {
    if (message.author?.bot) {
      return;
    }

    if (message.channelId !== this.config.channelId || message.guildId !== this.config.guildId) {
      return;
    }

    const input = this.normalize(message);
    this.handleMessage(input);
  }

  /**
   * Stop the Discord client.
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = undefined;
    }
  }
}
