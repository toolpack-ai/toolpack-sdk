import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';

/**
 * Configuration options for ScheduledChannel.
 */
export interface ScheduledChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** Cron expression (e.g., '0 9 * * 1-5' for 9am weekdays) */
  cron: string;

  /** Optional intent to pre-set in AgentInput */
  intent?: string;

  /** Where to deliver the output: 'slack:#channel' or 'webhook:https://...' */
  notify: string;
}

/**
 * Parsed cron expression components.
 */
interface CronComponents {
  minute: number | '*';
  hour: number | '*';
  dayOfMonth: number | '*';
  month: number | '*';
  dayOfWeek: number | '*';
}

/**
 * Scheduled channel that runs agents on a cron schedule.
 * Delivers output to the configured notification destination.
 */
export class ScheduledChannel extends BaseChannel {
  private config: ScheduledChannelConfig;
  private timer?: NodeJS.Timeout;
  private cronComponents: CronComponents;

  constructor(config: ScheduledChannelConfig) {
    super();
    this.name = config.name;
    this.config = config;
    this.cronComponents = this.parseCron(config.cron);
  }

  /**
   * Start the cron scheduler.
   */
  listen(): void {
    // Calculate initial delay and set up recurring schedule
    this.scheduleNextRun();
  }

  /**
   * Send the agent output to the configured notify destination.
   * @param output The agent output to send
   */
  async send(output: AgentOutput): Promise<void> {
    // Split only on the first colon to preserve URLs like https://...
    const colonIndex = this.config.notify.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid notify format: ${this.config.notify}. Expected format: 'slack:#channel' or 'webhook:https://...'`);
    }

    const protocol = this.config.notify.substring(0, colonIndex);
    const destination = this.config.notify.substring(colonIndex + 1);

    if (!protocol || !destination) {
      throw new Error(`Invalid notify format: ${this.config.notify}. Expected format: 'slack:#channel' or 'webhook:https://...'`);
    }

    switch (protocol.toLowerCase()) {
      case 'slack':
        await this.sendToSlack(destination, output);
        break;
      case 'webhook':
        await this.sendToWebhook(destination, output);
        break;
      default:
        throw new Error(`Unknown notify protocol: ${protocol}`);
    }
  }

  /**
   * Normalize the scheduled trigger into AgentInput.
   * Sets the intent and generates a date-keyed conversationId.
   * @param _incoming Ignored for scheduled triggers
   * @returns Normalized AgentInput
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  normalize(_incoming: unknown): AgentInput {
    const date = new Date();
    const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

    return {
      intent: this.config.intent,
      message: `Scheduled task triggered at ${date.toISOString()}`,
      conversationId: `scheduled:${this.name || 'default'}:${dateKey}`,
      data: {
        scheduled: true,
        cron: this.config.cron,
        timestamp: date.toISOString(),
      },
    };
  }

  /**
   * Send output to Slack.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendToSlack(channel: string, _output: AgentOutput): Promise<void> {
    // This would need a Slack token, which should be configured elsewhere
    // For now, this is a stub that throws an informative error
    throw new Error(
      `Slack notification requires configuration. ` +
      `Please use a named SlackChannel registered with AgentRegistry. ` +
      `Target channel: ${channel}`
    );
  }

  /**
   * Send output to a webhook URL.
   */
  private async sendToWebhook(url: string, output: AgentOutput): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        output: output.output,
        metadata: output.metadata,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook notification failed: ${response.statusText}`);
    }
  }

  /**
   * Parse a cron expression into components.
   */
  private parseCron(cron: string): CronComponents {
    const parts = cron.split(' ');
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: ${cron}. Expected 5 parts: minute hour day month weekday`);
    }

    const parsePart = (part: string): number | '*' => {
      if (part === '*') return '*';
      const num = parseInt(part, 10);
      if (isNaN(num)) {
        throw new Error(`Invalid cron part: ${part}`);
      }
      return num;
    };

    return {
      minute: parsePart(parts[0]),
      hour: parsePart(parts[1]),
      dayOfMonth: parsePart(parts[2]),
      month: parsePart(parts[3]),
      dayOfWeek: parsePart(parts[4]),
    };
  }

  /**
   * Calculate next run time based on cron components.
   */
  private getNextRunTime(): Date {
    const now = new Date();
    const next = new Date(now);

    // Simple implementation: find next matching time
    // This is a basic implementation; a production version would use a proper cron library

    if (this.cronComponents.minute !== '*') {
      next.setMinutes(this.cronComponents.minute as number);
      next.setSeconds(0);
      next.setMilliseconds(0);

      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
    }

    if (this.cronComponents.hour !== '*') {
      next.setHours(this.cronComponents.hour as number);

      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
    }

    return next;
  }

  /**
   * Schedule the next run.
   */
  private scheduleNextRun(): void {
    const nextRun = this.getNextRunTime();
    const delay = nextRun.getTime() - Date.now();

    console.log(`[ScheduledChannel] Next run scheduled for ${nextRun.toISOString()}`);

    this.timer = setTimeout(() => {
      this.trigger();
      this.scheduleNextRun(); // Schedule the next occurrence
    }, delay);
  }

  /**
   * Trigger the scheduled task.
   */
  private async trigger(): Promise<void> {
    const input = this.normalize(null);

    try {
      await this.handleMessage(input);
    } catch (error) {
      console.error('[ScheduledChannel] Error triggering scheduled task:', error);
    }
  }

  /**
   * Stop the scheduler.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
