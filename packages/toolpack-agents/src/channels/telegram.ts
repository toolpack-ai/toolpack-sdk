import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

/**
 * Configuration options for TelegramChannel.
 */
export interface TelegramChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** Telegram bot token (from @BotFather) */
  token: string;

  /** Optional webhook URL for receiving updates (if not using polling) */
  webhookUrl?: string;
}

/**
 * Telegram channel for two-way Telegram bot integration.
 * Receives messages from users and sends replies.
 */
export class TelegramChannel extends BaseChannel {
  readonly isTriggerChannel = false;
  private config: TelegramChannelConfig;
  private offset: number = 0;
  private pollingInterval?: NodeJS.Timeout;
  private server?: any; // HTTP server for webhook mode

  constructor(config: TelegramChannelConfig) {
    super();
    this.name = config.name;
    this.config = config;
  }

  /**
   * Start listening for Telegram updates.
   * Uses either webhook or polling mode depending on configuration.
   */
  listen(): void {
    if (this.config.webhookUrl) {
      this.startWebhook();
    } else {
      this.startPolling();
    }
  }

  /**
   * Send a message back to Telegram.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    // Get chat ID from metadata (set during normalize)
    const chatId = output.metadata?.chatId as string | number | undefined;

    if (!chatId) {
      throw new Error('Telegram send requires chatId in metadata');
    }

    const response = await fetch(`https://api.telegram.org/bot${this.config.token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: output.output,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send Telegram message: ${response.statusText}`);
    }

    const data = await response.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }
  }

  /**
   * Normalize a Telegram update into AgentInput.
   * @param incoming Telegram update object
   * @returns Normalized AgentInput
   */
  normalize(incoming: unknown): AgentInput {
    const update = incoming as Record<string, unknown>;

    // Get message from update (handles both message and edited_message)
    const message = (update.message as Record<string, unknown>) ||
                    (update.edited_message as Record<string, unknown>) ||
                    {};

    const text = (message.text as string) || '';
    const chat = (message.chat as Record<string, unknown>) || {};
    const from = (message.from as Record<string, unknown>) || {};

    return {
      message: text,
      conversationId: String(chat.id || ''),
      data: update,
      context: {
        chatId: chat.id,
        userId: from.id,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        messageId: message.message_id,
      },
    };
  }

  /**
   * Start polling for updates.
   */
  private startPolling(): void {
    console.log('[TelegramChannel] Starting polling mode');

    // Poll every 5 seconds
    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollUpdates();
      } catch (error) {
        console.error('[TelegramChannel] Polling error:', error);
      }
    }, 5000);
  }

  /**
   * Poll for updates from Telegram.
   */
  private async pollUpdates(): Promise<void> {
    const url = `https://api.telegram.org/bot${this.config.token}/getUpdates?offset=${this.offset + 1}&limit=100`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed: ${response.statusText}`);
    }

    const data = await response.json() as {
      ok: boolean;
      result: Array<Record<string, unknown>>;
    };

    if (!data.ok) {
      throw new Error('Telegram getUpdates returned not ok');
    }

    for (const update of data.result) {
      // Update offset
      const updateId = update.update_id as number;
      if (updateId >= this.offset) {
        this.offset = updateId + 1;
      }

      // Process the update
      try {
        const input = this.normalize(update);
        await this.handleMessage(input);
      } catch (error) {
        console.error('[TelegramChannel] Error processing update:', error);
      }
    }
  }

  /**
   * Start webhook server for receiving updates.
   */
  private startWebhook(): void {
    if (typeof process === 'undefined') return;

    console.log('[TelegramChannel] Starting webhook mode');

    import('http').then((http) => {
      this.server = http.createServer((req, res) => {
        this.handleWebhookRequest(req, res);
      });

      // Extract port from webhook URL or use default
      const url = new URL(this.config.webhookUrl || 'http://localhost:3000');
      const port = parseInt(url.port, 10) || 3000;

      this.server.listen(port, () => {
        console.log(`[TelegramChannel] Webhook server listening on port ${port}`);
      });

      // Set webhook with Telegram
      this.setWebhook();
    }).catch((err) => {
      console.error('[TelegramChannel] Failed to start webhook server:', err);
    });
  }

  /**
   * Set webhook URL with Telegram.
   */
  private async setWebhook(): Promise<void> {
    if (!this.config.webhookUrl) return;

    const response = await fetch(
      `https://api.telegram.org/bot${this.config.token}/setWebhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: this.config.webhookUrl,
        }),
      }
    );

    if (!response.ok) {
      console.error('[TelegramChannel] Failed to set webhook');
      return;
    }

    const data = await response.json() as { ok: boolean; description?: string };
    if (data.ok) {
      console.log('[TelegramChannel] Webhook set successfully');
    } else {
      console.error('[TelegramChannel] Failed to set webhook:', data.description);
    }
  }

  /**
   * Handle incoming webhook requests from Telegram.
   */
  private handleWebhookRequest(req: any, res: any): void {
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
      try {
        const update = JSON.parse(body);

        // Process the update asynchronously
        this.handleMessage(this.normalize(update)).catch((error) => {
          console.error('[TelegramChannel] Error processing webhook:', error);
        });

        res.writeHead(200);
        res.end('OK');
      } catch (error) {
        console.error('[TelegramChannel] Error parsing webhook:', error);
        res.writeHead(400);
        res.end('Bad request');
      }
    });
  }

  /**
   * Stop the channel (polling or webhook).
   */
  async stop(): Promise<void> {
    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    // Stop webhook server
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }

    // Delete webhook if set
    if (this.config.webhookUrl) {
      try {
        await fetch(
          `https://api.telegram.org/bot${this.config.token}/deleteWebhook`,
          { method: 'POST' }
        );
      } catch (error) {
        console.error('[TelegramChannel] Failed to delete webhook:', error);
      }
    }
  }
}
