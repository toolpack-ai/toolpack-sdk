import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

/**
 * Configuration options for SlackChannel.
 */
export interface SlackChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** Slack channel to listen to (e.g., '#support') */
  channel: string;

  /** Slack bot token (starts with 'xoxb-') */
  token: string;

  /** Slack app signing secret for request verification */
  signingSecret: string;

  /** Optional port for the HTTP server (default: 3000) */
  port?: number;
}

/**
 * Slack channel for two-way Slack integration.
 * Receives messages from users and replies in-thread.
 */
export class SlackChannel extends BaseChannel {
  private config: SlackChannelConfig;
  private server?: any; // HTTP server instance

  constructor(config: SlackChannelConfig) {
    super();
    this.name = config.name;
    this.config = {
      port: 3000,
      ...config,
    };
  }

  /**
   * Start listening for Slack events via HTTP webhook.
   */
  listen(): void {
    // In Phase 1, this sets up an HTTP server to receive Slack events
    // Full implementation would use a proper HTTP framework
    // This is a stub for the core structure

    if (typeof process !== 'undefined') {
      // Dynamic import to avoid loading during build if not needed
      import('http').then((http) => {
        this.server = http.createServer((req, res) => {
          this.handleRequest(req, res);
        });

        this.server.listen(this.config.port, () => {
          console.log(`[SlackChannel] Listening on port ${this.config.port} for channel ${this.config.channel}`);
        });
      }).catch((err) => {
        console.error('[SlackChannel] Failed to start HTTP server:', err);
      });
    }
  }

  /**
   * Send a message back to Slack.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    // Post message to Slack using chat.postMessage API
    // Use thread_ts from metadata for threaded replies (conversation continuity)
    const threadTs = output.metadata?.threadTs as string | undefined ||
                     output.metadata?.thread_ts as string | undefined;

    const payload: Record<string, unknown> = {
      channel: this.config.channel,
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

    // Extract thread timestamp for conversation continuity
    const threadTs = (event.thread_ts as string) || (event.ts as string);

    // Extract user info
    const user = event.user as string | undefined;

    return {
      message: text,
      conversationId: threadTs,
      data: event,
      context: {
        user,
        channel: event.channel as string,
        team: event.team as string,
      },
    };
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

          // Only process message events
          if (event.type === 'message' && !event.bot_id) {
            const input = this.normalize(event);
            this.handleMessage(input);
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
