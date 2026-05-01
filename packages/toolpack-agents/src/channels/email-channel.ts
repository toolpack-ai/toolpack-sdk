import { BaseChannel } from './base-channel.js';
import { AgentOutput } from '../agent/types.js';

/**
 * Configuration options for EmailChannel.
 */
export interface EmailChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** Sender email address */
  from: string;

  /** Recipient email address(es) - for scheduled/outbound emails */
  to: string | string[];

  /** SMTP configuration */
  smtp: {
    host: string;
    port: number;
    auth: {
      user: string;
      pass: string;
    };
    secure?: boolean;
  };

  /** Optional subject line template */
  subject?: string;
}

/**
 * Email channel for sending outbound emails via SMTP.
 * This is an outbound-only channel - for inbound email handling,
 * use a custom email-reader tool + WebhookChannel.
 */
export class EmailChannel extends BaseChannel {
  readonly isTriggerChannel = true;
  private config: EmailChannelConfig;
  private transporter?: any;

  constructor(config: EmailChannelConfig) {
    super();
    this.config = config;
    this.name = config.name;
  }

  /**
   * Initialize the email transporter.
   * EmailChannel is outbound-only, so listen() just sets up the transporter.
   */
  listen(): void {
    if (typeof process !== 'undefined') {
      import('nodemailer').then((nodemailer) => {
        this.transporter = nodemailer.default.createTransport({
          host: this.config.smtp.host,
          port: this.config.smtp.port,
          secure: this.config.smtp.secure ?? (this.config.smtp.port === 465),
          auth: {
            user: this.config.smtp.auth.user,
            pass: this.config.smtp.auth.pass,
          },
        });

        console.log(`[EmailChannel] Email transporter initialized for ${this.config.from}`);
      }).catch((err) => {
        console.error('[EmailChannel] Failed to initialize nodemailer:', err);
        console.error('[EmailChannel] Make sure to install nodemailer: npm install nodemailer');
      });
    }
  }

  /**
   * Send an email with the agent's output.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not initialized. Did you call listen()?');
    }

    const recipients = Array.isArray(this.config.to) ? this.config.to : [this.config.to];
    const subject = this.config.subject || 'Message from Agent';

    const mailOptions = {
      from: this.config.from,
      to: recipients.join(', '),
      subject,
      text: output.output,
      html: this.formatAsHtml(output.output),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[EmailChannel] Email sent: ${info.messageId}`);
    } catch (error) {
      console.error('[EmailChannel] Failed to send email:', error);
      throw new Error(`Failed to send email: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * EmailChannel is outbound-only and doesn't receive messages.
   * This method should not be called.
   */
  normalize(_incoming: unknown): never {
    throw new Error('EmailChannel is outbound-only. Use WebhookChannel with email webhook events for inbound email.');
  }

  /**
   * Format plain text as HTML for better email rendering.
   */
  private formatAsHtml(text: string): string {
    return text
      .split('\n\n')
      .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  /**
   * Close the email transporter.
   */
  async stop(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = undefined;
    }
  }
}
