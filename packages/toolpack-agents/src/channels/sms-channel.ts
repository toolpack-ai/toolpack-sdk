import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

/**
 * Configuration options for SMSChannel (Twilio).
 */
export interface SMSChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** Twilio Account SID */
  accountSid: string;

  /** Twilio Auth Token */
  authToken: string;

  /** Twilio phone number (sender) */
  from: string;

  /** Recipient phone number - for outbound/scheduled SMS */
  to?: string;

  /** Optional webhook path for inbound SMS (e.g., '/sms/webhook') */
  webhookPath?: string;

  /** Optional port for the HTTP server (default: 3000) */
  port?: number;
}

/**
 * SMS channel for Twilio integration.
 * Can be configured as:
 * - Two-way: Set webhookPath to receive inbound SMS and reply
 * - Outbound-only: Set 'to' without webhookPath for scheduled/triggered SMS
 */
export class SMSChannel extends BaseChannel {
  private config: SMSChannelConfig;
  private twilioClient?: any;
  private server?: any;

  constructor(config: SMSChannelConfig) {
    super();
    this.config = {
      port: 3000,
      ...config,
    };
    this.name = config.name;
  }

  /**
   * Two-way when webhookPath is set, outbound-only otherwise.
   */
  get isTriggerChannel(): boolean {
    return !this.config.webhookPath;
  }

  /**
   * Start listening for inbound SMS via Twilio webhook (if webhookPath is set).
   */
  listen(): void {
    if (typeof process !== 'undefined') {
      import('twilio').then((twilio) => {
        this.twilioClient = twilio.default(this.config.accountSid, this.config.authToken);
        console.log(`[SMSChannel] Twilio client initialized`);

        if (this.config.webhookPath) {
          this.startWebhookServer();
        }
      }).catch((err) => {
        console.error('[SMSChannel] Failed to initialize Twilio client:', err);
        console.error('[SMSChannel] Make sure to install twilio: npm install twilio');
      });
    }
  }

  /**
   * Send an SMS message.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized. Did you call listen()?');
    }

    const recipient = (output.metadata?.from as string) || this.config.to;

    if (!recipient) {
      throw new Error('No recipient phone number specified. Set "to" in config or provide in output.metadata.from');
    }

    try {
      const message = await this.twilioClient.messages.create({
        body: output.output,
        from: this.config.from,
        to: recipient,
      });

      console.log(`[SMSChannel] SMS sent: ${message.sid}`);
    } catch (error) {
      console.error('[SMSChannel] Failed to send SMS:', error);
      throw new Error(`Failed to send SMS: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Normalize a Twilio webhook payload into AgentInput.
   * @param incoming Twilio webhook payload
   * @returns Normalized AgentInput
   */
  normalize(incoming: unknown): AgentInput {
    const payload = incoming as Record<string, unknown>;

    const from = payload.From as string;
    const body = payload.Body as string;
    const messageSid = payload.MessageSid as string;

    return {
      message: body,
      conversationId: from,
      data: payload,
      context: {
        from,
        to: payload.To as string,
        messageSid,
      },
    };
  }

  /**
   * Start HTTP server to receive Twilio webhooks.
   */
  private startWebhookServer(): void {
    import('http').then((http) => {
      this.server = http.createServer((req, res) => {
        this.handleWebhookRequest(req, res);
      });

      this.server.listen(this.config.port, () => {
        console.log(`[SMSChannel] Webhook server listening on port ${this.config.port} at ${this.config.webhookPath}`);
      });
    }).catch((err) => {
      console.error('[SMSChannel] Failed to start webhook server:', err);
    });
  }

  /**
   * Handle incoming webhook requests from Twilio.
   */
  private handleWebhookRequest(req: any, res: any): void {
    if (req.method !== 'POST' || req.url !== this.config.webhookPath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const params = new URLSearchParams(body);
        const payload: Record<string, string> = {};

        params.forEach((value, key) => {
          payload[key] = value;
        });

        const input = this.normalize(payload);
        this.handleMessage(input);

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      } catch (error) {
        console.error('[SMSChannel] Error handling webhook:', error);
        res.writeHead(400);
        res.end('Bad request');
      }
    });
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }
}
