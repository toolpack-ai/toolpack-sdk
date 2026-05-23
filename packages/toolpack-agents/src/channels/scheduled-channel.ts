import { BaseChannel } from './base-channel.js';
import { AgentInput, AgentOutput } from '../agent/types.js';
import { CronExpressionParser } from 'cron-parser';
import type { SchedulerStore } from '../scheduler/scheduler-store.js';
import type { ScheduledJob } from '../scheduler/scheduler-types.js';

/**
 * Configuration for ScheduledChannel.
 *
 * Provide `cron` for a simple static schedule, `store` for dynamic agent-driven
 * scheduling, or both — the store takes precedence when both are supplied, and
 * the `cron` is seeded into the store as an initial job on `listen()`.
 *
 * Output delivery is the agent's responsibility. Use `sendTo()` inside
 * `invokeAgent()` to route results to a named channel (Slack, webhook, etc.).
 */
export interface ScheduledChannelConfig {
  /** Optional name — required for `sendTo()` routing in multi-channel setups. */
  name?: string;

  /**
   * Static cron expression.
   * Used directly when no `store` is provided.
   * When a `store` is also provided, this is seeded into the store as an
   * initial recurring job (subject to deduplication).
   *
   * Supports 5-field (min hour dom month dow) and 6-field (sec min hour dom month dow).
   * Example: `'0 9 * * 1-5'` for 9am on weekdays.
   */
  cron?: string;

  /**
   * Dynamic scheduler store.
   * When provided, the channel polls the store for due jobs instead of (or in
   * addition to) the static cron. The store drives all scheduling decisions,
   * enabling agents to schedule their own future invocations via scheduler tools.
   */
  store?: SchedulerStore;

  /** Default intent forwarded to AgentInput when no job-level intent is set. */
  intent?: string;

  /** Default message forwarded to AgentInput when no job-level message is set. */
  message?: string;

  /**
   * How often (in ms) to poll the store for new jobs when it is currently empty.
   * Agents that create new jobs via `scheduler.create` while the store is idle
   * will be picked up within this interval.
   *
   * Default: `30_000` (30 seconds).
   */
  idlePollMs?: number;
}

/**
 * A trigger-only channel that runs agents on a cron schedule or via a
 * dynamic SchedulerStore.
 *
 * - No `notify` option — output delivery is the agent's responsibility.
 * - `isTriggerChannel = true` — `this.ask()` is not available inside triggered runs.
 * - When a `store` is provided, supports missed-run recovery on startup and
 *   lets agents schedule their own future invocations using `scheduler.*` tools.
 *
 * @example Static cron
 * ```ts
 * const channel = new ScheduledChannel({
 *   name: 'daily',
 *   cron: '0 9 * * 1-5',
 *   intent: 'daily_report',
 * });
 * ```
 *
 * @example Dynamic store (agent-driven scheduling)
 * ```ts
 * const store = new SchedulerStore({ dbPath: './scheduler.db' });
 *
 * const channel = new ScheduledChannel({
 *   name: 'dynamic',
 *   store,
 * });
 *
 * // Agent tools: scheduler.create / scheduler.list / scheduler.cancel / scheduler.update
 * ```
 *
 * @example Both — static seed + dynamic store
 * ```ts
 * const store = new SchedulerStore({ dbPath: './scheduler.db' });
 *
 * const channel = new ScheduledChannel({
 *   name: 'hybrid',
 *   cron: '0 9 * * 1-5',  // seeded into store on listen()
 *   store,
 *   intent: 'morning_check',
 *   idlePollMs: 10_000,   // check for agent-created jobs every 10s when idle
 * });
 * ```
 */
export class ScheduledChannel extends BaseChannel {
  readonly isTriggerChannel = true;
  private config: ScheduledChannelConfig;
  private timer?: ReturnType<typeof setTimeout>;
  private _stopped = false;
  /**
   * Incremented each time `listen()` is called. Callbacks capture the value at
   * the moment they are created; if it no longer matches `_generation` by the
   * time they resume, they know a new listen-cycle has started and self-cancel.
   * This prevents a stop()+listen() during an in-flight async callback from
   * spawning a second independent timer loop.
   */
  private _generation = 0;

  constructor(config: ScheduledChannelConfig) {
    super();

    if (!config.cron && !config.store) {
      throw new Error(
        'ScheduledChannel: provide at least one of `cron` (static schedule) or `store` (dynamic scheduling).'
      );
    }

    if (config.cron) {
      try {
        CronExpressionParser.parse(config.cron);
      } catch (error) {
        throw new Error(`ScheduledChannel: invalid cron expression '${config.cron}': ${(error as Error).message}`);
      }
    }

    if (config.store && !config.name) {
      console.warn(
        '[ScheduledChannel] A `store` was provided without a `name`. ' +
        'All store queries will be unscoped and will pick up jobs from every channel. ' +
        'Set `name` to scope this channel to its own jobs.'
      );
    }

    if (config.idlePollMs !== undefined && config.idlePollMs < 1000) {
      throw new Error(
        `ScheduledChannel: idlePollMs must be at least 1000ms (got ${config.idlePollMs}). ` +
        'Values below 1 second create a tight polling loop.'
      );
    }

    this.config = config;
    this.name = config.name;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the scheduler.
   *
   * - Static-only mode: sets up a recurring setTimeout loop.
   * - Store mode: seeds the static cron (if any), recovers missed runs, then
   *   sets up a smart-sleep loop driven by the store's next pending job.
   */
  listen(): void {
    // Bump generation first — any in-flight callback from a previous cycle will
    // see a stale generation and refuse to set a new timer.
    this._generation++;
    // Clear a pending (not-yet-fired) timer from the previous cycle.
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this._stopped = false;
    if (this.config.store) {
      this._listenWithStore();
    } else {
      this._listenStatic();
    }
  }

  /**
   * Stop the scheduler and clear any pending timer.
   */
  async stop(): Promise<void> {
    this._stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * ScheduledChannel is a pure trigger — output delivery is handled by the
   * agent via `sendTo()`. This method is intentionally a no-op.
   */
  async send(_output: AgentOutput): Promise<void> {
    // Delivery is the agent's responsibility (use sendTo() inside invokeAgent()).
  }

  /**
   * Normalize a scheduled trigger (or store job) into AgentInput.
   *
   * @param incoming A ScheduledJob from the store, or null for static cron triggers.
   */
  normalize(incoming: unknown): AgentInput {
    const job = incoming as ScheduledJob | null;
    const date = new Date();
    const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

    return {
      intent: job?.intent ?? this.config.intent,
      message: job?.message
        ?? this.config.message
        ?? `Scheduled task triggered at ${date.toISOString()}`,
      conversationId: `scheduled:${this.name ?? 'default'}:${dateKey}`,
      data: {
        // Payload first so framework-set fields always win over user-supplied values.
        ...(job?.payload ?? {}),
        scheduled: true,
        jobId: job?.id,
        cron: job?.cron ?? this.config.cron,
        timestamp: date.toISOString(),
      },
    };
  }

  // ── Static (cron-only) mode ───────────────────────────────────────────────

  private _listenStatic(): void {
    this._scheduleNextStatic(this._generation);
  }

  private _scheduleNextStatic(gen: number): void {
    if (this._stopped || gen !== this._generation) return;

    const nextRun = this._nextRunFromCron(this.config.cron!);
    const delay = nextRun.getTime() - Date.now();

    if (delay <= 0) {
      // Avoid synchronous recursion (e.g. with mocked clocks); yield to the event loop
      this.timer = setTimeout(() => this._scheduleNextStatic(gen), 0);
      return;
    }

    console.log(`[ScheduledChannel:${this.name ?? 'default'}] Next run: ${nextRun.toISOString()}`);

    // async callback: await the trigger so slow agents never overlap with the
    // next scheduled tick (sequential execution, not fire-and-forget).
    this.timer = setTimeout(async () => {
      // Guard: stop() may have been called in the same tick the timer fired.
      if (this._stopped || gen !== this._generation) return;
      await this._triggerStatic();
      this._scheduleNextStatic(gen);
    }, delay);
  }

  private async _triggerStatic(): Promise<void> {
    if (!this._handler) {
      console.warn(
        `[ScheduledChannel:${this.name ?? 'default'}] Cron fired but no message handler is registered. ` +
        'Call onMessage() before listen() to avoid silently losing triggers.'
      );
      return;
    }
    const input = this.normalize(null);
    try {
      await this.handleMessage(input);
    } catch (error) {
      console.error(`[ScheduledChannel:${this.name ?? 'default'}] Error on trigger:`, error);
    }
  }

  // ── Store mode ────────────────────────────────────────────────────────────

  private _listenWithStore(): void {
    const store = this.config.store!;
    const gen = this._generation;

    // Recover jobs that were mid-execution when the PREVIOUS PROCESS crashed.
    // They are stuck as 'running' and would never be retried since getDue()
    // only returns 'pending' jobs. Reset them to 'pending' before doing
    // anything else so they are picked up by the missed-run check below.
    //
    // IMPORTANT: only do this on the very first listen() call of this process
    // (gen === 1). On a stop()+listen() cycle within the same process, overdue
    // jobs from the previous cycle are already marked 'running' by their
    // in-flight _triggerJob calls. Calling resetStuck() again would race those
    // handlers back to 'pending' and cause the same job to be executed twice.
    if (gen === 1) {
      const stuck = store.resetStuck(this.name);
      if (stuck > 0) {
        console.log(
          `[ScheduledChannel:${this.name ?? 'default'}] Reset ${stuck} stuck 'running' job(s) to 'pending'.`
        );
      }
    }

    // Seed the static cron into the store if provided (dedup prevents duplicates on restart)
    if (this.config.cron) {
      const { duplicate } = store.create({
        channelName: this.name,
        cron: this.config.cron,
        intent: this.config.intent,
        message: this.config.message,
      });
      if (!duplicate) {
        console.log(
          `[ScheduledChannel:${this.name ?? 'default'}] Seeded static cron '${this.config.cron}' into store.`
        );
      }
    }

    // Missed-run recovery — execute any overdue jobs immediately
    const overdueJobs = store.getDue(Date.now(), this.name);
    if (overdueJobs.length > 0) {
      console.log(
        `[ScheduledChannel:${this.name ?? 'default'}] Recovering ${overdueJobs.length} overdue job(s).`
      );
      // Fire-and-forget; errors are caught and recorded inside _triggerJob
      void Promise.allSettled(overdueJobs.map(job => this._triggerJob(job)));
    }

    // Start the smart-sleep polling loop
    this._scheduleNextFromStore(gen);
  }

  private _scheduleNextFromStore(gen: number): void {
    if (this._stopped || gen !== this._generation) return;

    const store = this.config.store!;
    const next = store.getNextPending(this.name);

    if (!next) {
      // No pending jobs — poll at the configured idle interval in case an agent
      // creates new ones via scheduler.create while the store is empty.
      const idlePollMs = this.config.idlePollMs ?? 30_000;
      this.timer = setTimeout(() => this._scheduleNextFromStore(gen), idlePollMs);
      return;
    }

    const delay = Math.max(0, next.nextRunAt - Date.now());

    console.log(
      `[ScheduledChannel:${this.name ?? 'default'}] Next store job at ${new Date(next.nextRunAt).toISOString()} (in ${Math.round(delay / 1000)}s)`
    );

    this.timer = setTimeout(async () => {
      // Guard: stop() may have been called in the same tick the timer fired.
      if (this._stopped || gen !== this._generation) return;

      // Execute all due jobs (there may be multiple if several came due simultaneously)
      const dueJobs = store.getDue(Date.now(), this.name);
      await Promise.allSettled(dueJobs.map(job => this._triggerJob(job)));

      // Reschedule after processing
      this._scheduleNextFromStore(gen);
    }, delay);
  }

  private async _triggerJob(job: ScheduledJob): Promise<void> {
    const store = this.config.store!;

    if (!this._handler) {
      console.warn(
        `[ScheduledChannel:${this.name ?? 'default'}] Job ${job.id} fired but no message handler is registered. ` +
        'Call onMessage() before listen() to avoid silently losing jobs.'
      );
      store.markFailed(job.id, 'No message handler registered');
      return;
    }

    store.markRunning(job.id);

    const input = this.normalize(job);
    try {
      await this.handleMessage(input);
      store.markCompleted(job.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `[ScheduledChannel:${this.name ?? 'default'}] Job ${job.id} failed:`, error
      );
      store.markFailed(job.id, msg);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _nextRunFromCron(cron: string): Date {
    const interval = CronExpressionParser.parse(cron, { currentDate: new Date() });
    return interval.next().toDate();
  }
}
