import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';
import cronParserModule from 'cron-parser';

// Type assertion for cron-parser which has incorrect type definitions
const cronParser = cronParserModule as any;

/**
 * Configuration options for ScheduledChannel.
 */
export interface ScheduledChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /** 
   * Cron expression - supports full cron syntax including wildcards, ranges, steps, and lists.
   * Examples: '0 9 * * 1-5' for 9am weekdays, or '* /15 * * * *' for every 15 minutes
   */
  cron: string;

  /** Optional intent to pre-set in AgentInput */
  intent?: string;

  /** Optional message to send to the agent on each trigger */
  message?: string;

  /** Where to deliver the output: 'slack:#channel', 'webhook:https://...', or 'console' for logging only */
  notify: string;
}


/**
 * Scheduled channel that runs agents on a cron schedule.
 * Delivers output to the configured notification destination.
 */
export class ScheduledChannel extends BaseChannel {
  readonly isTriggerChannel = true;
  private config: ScheduledChannelConfig;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(config: ScheduledChannelConfig) {
    super();
    this.config = config;
    this.name = config.name;
    
    // Validate cron expression on construction
    try {
      cronParser.parse(config.cron);
    } catch (error) {
      throw new Error(`Invalid cron expression '${config.cron}': ${(error as Error).message}`);
    }
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
   * Calculate next run time using cron-parser.
   */
  private getNextRunTime(): Date {
    const interval = cronParser.parse(this.config.cron, {
      currentDate: new Date(),
    });
    
    return interval.next().toDate();
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
