import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';
import { CronExpressionParser } from 'cron-parser';

/**
 * Configuration options for ScheduledChannel.
 */
export interface ScheduledChannelConfig {
  /** Optional name for the channel - required for sendTo() routing */
  name?: string;

  /**
   * Cron expression - supports full cron syntax including wildcards, ranges, steps, and lists.
   * Supports both 5-field (min hour dom month dow) and 6-field (sec min hour dom month dow) expressions.
   * Examples: '0 9 * * 1-5' for 9am weekdays, or '0 * /15 * * * *' for every 15 minutes (6-field)
   */
  cron: string;

  /** Optional intent to pre-set in AgentInput */
  intent?: string;

  /** Optional message to send to the agent on each trigger */
  message?: string;

  /**
   * Where to deliver the output. Supported protocols:
   *
   * - `webhook:<https-url>` — POSTs JSON `{ output, metadata, timestamp }` to the URL.
   *
   * For Slack delivery, attach a named `SlackChannel` to the same agent and
   * route from inside `run()`:
   *
   * ```ts
   * agent.channels = [
   *   new ScheduledChannel({ name: 'daily', cron: '0 9 * * 1-5', notify: 'webhook:...' }),
   *   new SlackChannel({ name: 'kore-slack', channel: '#project-kore', token, signingSecret }),
   * ];
   *
   * async run(input) {
   *   const report = await this.buildReport();
   *   await this.sendTo('kore-slack', report);
   *   return { output: report };
   * }
   * ```
   *
   * This keeps Slack credentials, thread routing, and multi-channel listening
   * in one place (`SlackChannel`) instead of duplicated inside `ScheduledChannel`.
   */
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
      CronExpressionParser.parse(config.cron);
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
      throw new Error(`Invalid notify format: ${this.config.notify}. Expected format: 'webhook:https://...'`);
    }

    const protocol = this.config.notify.substring(0, colonIndex);
    const destination = this.config.notify.substring(colonIndex + 1);

    if (!protocol || !destination) {
      throw new Error(`Invalid notify format: ${this.config.notify}. Expected format: 'webhook:https://...'`);
    }

    switch (protocol.toLowerCase()) {
      case 'webhook':
        await this.sendToWebhook(destination, output);
        break;
      case 'slack':
        throw new Error(
          `ScheduledChannel no longer supports the 'slack:' notify protocol. ` +
          `Attach a named SlackChannel to the agent and route from inside run() via ` +
          `this.sendTo('<channelName>', output). See ScheduledChannelConfig.notify docs.`
        );
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
    const interval = CronExpressionParser.parse(this.config.cron, {
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

    if (delay <= 0) {
      // Next run is in the past (race condition) — reschedule immediately
      this.scheduleNextRun();
      return;
    }

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
