import Database from 'better-sqlite3';
import { CronExpressionParser } from 'cron-parser';
import {
  ScheduledJob,
  CreateJobOptions,
  CreateJobResult,
  JobStatus,
} from './scheduler-types.js';

/**
 * SQLite-backed persistent store for scheduled jobs.
 *
 * @example
 * ```ts
 * const store = new SchedulerStore({ dbPath: './scheduler.db' });
 *
 * // Create a recurring job
 * const { job } = store.create({
 *   intent: 'weekly_report',
 *   cron: '0 9 * * 1',
 *   message: 'Generate weekly summary',
 * });
 *
 * // Create a one-shot job
 * store.create({
 *   intent: 'onboarding_followup',
 *   runAt: new Date('2026-06-01T10:00:00Z'),
 * });
 * ```
 */
export class SchedulerStore {
  private db: Database.Database;

  constructor({ dbPath = ':memory:' }: { dbPath?: string } = {}) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._migrate();
  }

  // ── Schema ────────────────────────────────────────────────────────────────

  private _migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id           TEXT    PRIMARY KEY,
        channel_name TEXT,
        next_run_at  INTEGER NOT NULL,
        cron         TEXT,
        intent       TEXT,
        message      TEXT,
        payload      TEXT,
        status       TEXT    NOT NULL DEFAULT 'pending',
        last_run_at  INTEGER,
        last_error   TEXT,
        created_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run
        ON scheduled_jobs (status, next_run_at);

      CREATE INDEX IF NOT EXISTS idx_jobs_channel
        ON scheduled_jobs (channel_name, status);
    `);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Create a new scheduled job.
   *
   * **Deduplication** — before inserting, checks for an existing `pending` job
   * with the same key:
   * - Recurring (`cron`): matched on `(intent, cron, channel_name)`
   * - One-shot (`runAt`): matched on `(intent, next_run_at, channel_name)`
   *
   * Returns the existing job with `duplicate: true` instead of creating a duplicate.
   */
  create(opts: CreateJobOptions): CreateJobResult {
    if (!opts.cron && !opts.runAt) {
      throw new Error('SchedulerStore.create: either cron or runAt must be provided.');
    }
    if (opts.cron && opts.runAt) {
      throw new Error('SchedulerStore.create: provide cron OR runAt, not both.');
    }

    // Compute nextRunAt
    let nextRunAt: number;
    if (opts.cron) {
      try {
        const interval = CronExpressionParser.parse(opts.cron, { currentDate: new Date() });
        nextRunAt = interval.next().toDate().getTime();
      } catch {
        throw new Error(`SchedulerStore.create: invalid cron expression '${opts.cron}'`);
      }
    } else {
      nextRunAt = opts.runAt instanceof Date ? opts.runAt.getTime() : (opts.runAt as number);
      if (isNaN(nextRunAt)) {
        throw new Error(`SchedulerStore.create: invalid runAt value '${opts.runAt}'`);
      }
    }

    // Deduplication check
    const existing = this._findDuplicate(opts, nextRunAt);
    if (existing) {
      return { job: existing, duplicate: true };
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO scheduled_jobs
        (id, channel_name, next_run_at, cron, intent, message, payload, status, created_at)
      VALUES
        (@id, @channelName, @nextRunAt, @cron, @intent, @message, @payload, 'pending', @createdAt)
    `).run({
      id,
      channelName: opts.channelName ?? null,
      nextRunAt,
      cron: opts.cron ?? null,
      intent: opts.intent ?? null,
      message: opts.message ?? null,
      payload: opts.payload ? JSON.stringify(opts.payload) : null,
      createdAt: now,
    });

    return { job: this._getById(id)!, duplicate: false };
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Get a single job by ID.
   */
  get(id: string): ScheduledJob | undefined {
    return this._getById(id) ?? undefined;
  }

  /**
   * List jobs, optionally filtered by status and channel.
   */
  list(filter: {
    status?: JobStatus | 'all';
    channelName?: string;
    limit?: number;
  } = {}): ScheduledJob[] {
    const { status = 'pending', channelName, limit = 20 } = filter;

    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit };

    if (status !== 'all') {
      conditions.push('status = @status');
      params.status = status;
    }
    if (channelName !== undefined) {
      conditions.push('channel_name = @channelName');
      params.channelName = channelName;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db.prepare(`
      SELECT * FROM scheduled_jobs
      ${where}
      ORDER BY next_run_at ASC
      LIMIT @limit
    `).all(params) as RawRow[];

    return rows.map(rowToJob);
  }

  /**
   * Return all pending jobs whose nextRunAt <= now (due or overdue).
   * Used by ScheduledChannel for missed-run recovery and normal polling.
   * Pass `channelName` to scope results to a specific channel.
   */
  getDue(now: number = Date.now(), channelName?: string): ScheduledJob[] {
    const rows = channelName
      ? this.db.prepare(`
          SELECT * FROM scheduled_jobs
          WHERE status = 'pending' AND next_run_at <= @now AND channel_name = @channelName
          ORDER BY next_run_at ASC
        `).all({ now, channelName }) as RawRow[]
      : this.db.prepare(`
          SELECT * FROM scheduled_jobs
          WHERE status = 'pending' AND next_run_at <= @now
          ORDER BY next_run_at ASC
        `).all({ now }) as RawRow[];

    return rows.map(rowToJob);
  }

  /**
   * Return the single next pending job (earliest nextRunAt).
   * Used by ScheduledChannel to calculate optimal sleep duration.
   */
  getNextPending(channelName?: string): ScheduledJob | undefined {
    const row = channelName
      ? this.db.prepare(`
          SELECT * FROM scheduled_jobs
          WHERE status = 'pending' AND channel_name = @channelName
          ORDER BY next_run_at ASC LIMIT 1
        `).get({ channelName }) as RawRow | undefined
      : this.db.prepare(`
          SELECT * FROM scheduled_jobs
          WHERE status = 'pending'
          ORDER BY next_run_at ASC LIMIT 1
        `).get() as RawRow | undefined;

    return row ? rowToJob(row) : undefined;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * Update an existing pending job.
   */
  update(id: string, updates: {
    cron?: string;
    message?: string;
    intent?: string;
    runAt?: Date | number;
    payload?: Record<string, unknown>;
  }): ScheduledJob | undefined {
    const job = this._getById(id);
    if (!job) return undefined;
    if (job.status !== 'pending') {
      throw new Error(`Cannot update job ${id}: status is '${job.status}', expected 'pending'.`);
    }
    if (updates.cron !== undefined && updates.runAt !== undefined) {
      throw new Error(`Cannot update job ${id}: provide cron OR runAt, not both.`);
    }

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.cron !== undefined) {
      try {
        CronExpressionParser.parse(updates.cron);
      } catch {
        throw new Error(`Invalid cron expression '${updates.cron}'`);
      }
      setClauses.push('cron = @cron');
      params.cron = updates.cron;

      // Recalculate nextRunAt from new cron
      const interval = CronExpressionParser.parse(updates.cron, { currentDate: new Date() });
      params.nextRunAt = interval.next().toDate().getTime();
      setClauses.push('next_run_at = @nextRunAt');
    }

    if (updates.runAt !== undefined) {
      const nextRunAt = updates.runAt instanceof Date
        ? updates.runAt.getTime()
        : updates.runAt;
      if (isNaN(nextRunAt)) {
        throw new Error(`Cannot update job ${id}: invalid runAt value '${updates.runAt}'`);
      }
      params.nextRunAt = nextRunAt;
      setClauses.push('next_run_at = @nextRunAt');
      // Clear cron so the job becomes a one-shot. Without this, markCompleted
      // would see cron still set and reschedule the job as recurring, ignoring
      // the intent of switching it to a specific one-time run.
      setClauses.push('cron = NULL');
    }

    if (updates.message !== undefined) {
      setClauses.push('message = @message');
      params.message = updates.message;
    }

    if (updates.intent !== undefined) {
      setClauses.push('intent = @intent');
      params.intent = updates.intent;
    }

    if (updates.payload !== undefined) {
      setClauses.push('payload = @payload');
      params.payload = JSON.stringify(updates.payload);
    }

    if (setClauses.length === 0) return job;

    this.db.prepare(`
      UPDATE scheduled_jobs SET ${setClauses.join(', ')} WHERE id = @id
    `).run(params);

    return this._getById(id)!;
  }

  /**
   * Cancel a pending job. Returns true if cancelled, false if not found or not pending.
   */
  cancel(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE scheduled_jobs SET status = 'cancelled'
      WHERE id = @id AND status = 'pending'
    `).run({ id });

    return result.changes > 0;
  }

  // ── Lifecycle (used by ScheduledChannel) ──────────────────────────────────

  /**
   * Reset any jobs stuck in `running` state back to `pending`.
   *
   * Should be called once on ScheduledChannel startup. A job can get stuck as
   * `running` if the process crashes after `markRunning()` but before
   * `markCompleted()` or `markFailed()`. Without this call those jobs would
   * never be retried since `getDue()` only returns `pending` jobs.
   *
   * Pass `channelName` to scope the reset to a specific channel.
   *
   * @returns The number of jobs reset.
   */
  resetStuck(channelName?: string): number {
    const result = channelName
      ? this.db.prepare(`
          UPDATE scheduled_jobs SET status = 'pending'
          WHERE status = 'running' AND channel_name = @channelName
        `).run({ channelName })
      : this.db.prepare(`
          UPDATE scheduled_jobs SET status = 'pending' WHERE status = 'running'
        `).run();
    return result.changes;
  }

  /** Mark a job as running (called before execution). */
  markRunning(id: string): void {
    this.db.prepare(`
      UPDATE scheduled_jobs SET status = 'running' WHERE id = @id
    `).run({ id });
  }

  /** Mark a completed job. For recurring jobs, calculates and sets the next run time. */
  markCompleted(id: string): void {
    const job = this._getById(id);
    if (!job) return;

    const now = Date.now();

    if (job.cron) {
      // Recurring — reschedule from now
      let nextRunAt: number;
      try {
        const interval = CronExpressionParser.parse(job.cron, { currentDate: new Date() });
        nextRunAt = interval.next().toDate().getTime();
      } catch {
        // Stored cron is corrupt — mark failed rather than crashing the scheduler loop.
        this.markFailed(id, `markCompleted: corrupt cron expression '${job.cron}'`);
        return;
      }

      this.db.prepare(`
        UPDATE scheduled_jobs
        SET status = 'pending', last_run_at = @now, next_run_at = @nextRunAt, last_error = NULL
        WHERE id = @id
      `).run({ id, now, nextRunAt });
    } else {
      // One-shot — mark completed permanently
      this.db.prepare(`
        UPDATE scheduled_jobs
        SET status = 'completed', last_run_at = @now, last_error = NULL
        WHERE id = @id
      `).run({ id, now });
    }
  }

  /** Mark a job as failed and store the error. Recurring jobs are rescheduled. */
  markFailed(id: string, error: string): void {
    const job = this._getById(id);
    if (!job) return;

    const now = Date.now();

    if (job.cron) {
      let nextRunAt: number;
      try {
        const interval = CronExpressionParser.parse(job.cron, { currentDate: new Date() });
        nextRunAt = interval.next().toDate().getTime();
      } catch {
        // Stored cron is corrupt — mark permanently failed rather than crashing.
        this.db.prepare(`
          UPDATE scheduled_jobs
          SET status = 'failed', last_run_at = @now,
              last_error = @compositeError
          WHERE id = @id
        `).run({
          id,
          now,
          compositeError: `${error} | corrupt cron: '${job.cron}'`,
        });
        return;
      }

      this.db.prepare(`
        UPDATE scheduled_jobs
        SET status = 'pending', last_run_at = @now, last_error = @error, next_run_at = @nextRunAt
        WHERE id = @id
      `).run({ id, now, error, nextRunAt });
    } else {
      this.db.prepare(`
        UPDATE scheduled_jobs
        SET status = 'failed', last_run_at = @now, last_error = @error
        WHERE id = @id
      `).run({ id, now, error });
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private _getById(id: string): ScheduledJob | null {
    const row = this.db.prepare(
      'SELECT * FROM scheduled_jobs WHERE id = @id'
    ).get({ id }) as RawRow | undefined;

    return row ? rowToJob(row) : null;
  }

  private _findDuplicate(opts: CreateJobOptions, nextRunAt: number): ScheduledJob | null {
    let row: RawRow | undefined;

    if (opts.cron) {
      row = this.db.prepare(`
        SELECT * FROM scheduled_jobs
        WHERE status = 'pending'
          AND cron = @cron
          AND (intent IS @intent OR (intent IS NULL AND @intent IS NULL))
          AND (channel_name IS @channelName OR (channel_name IS NULL AND @channelName IS NULL))
        LIMIT 1
      `).get({
        cron: opts.cron,
        intent: opts.intent ?? null,
        channelName: opts.channelName ?? null,
      }) as RawRow | undefined;
    } else {
      row = this.db.prepare(`
        SELECT * FROM scheduled_jobs
        WHERE status = 'pending'
          AND next_run_at = @nextRunAt
          AND (intent IS @intent OR (intent IS NULL AND @intent IS NULL))
          AND (channel_name IS @channelName OR (channel_name IS NULL AND @channelName IS NULL))
        LIMIT 1
      `).get({
        nextRunAt,
        intent: opts.intent ?? null,
        channelName: opts.channelName ?? null,
      }) as RawRow | undefined;
    }

    return row ? rowToJob(row) : null;
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }
}

// ── Row mapping ───────────────────────────────────────────────────────────────

interface RawRow {
  id: string;
  channel_name: string | null;
  next_run_at: number;
  cron: string | null;
  intent: string | null;
  message: string | null;
  payload: string | null;
  status: JobStatus;
  last_run_at: number | null;
  last_error: string | null;
  created_at: number;
}

function rowToJob(row: RawRow): ScheduledJob {
  return {
    id: row.id,
    channelName: row.channel_name ?? undefined,
    nextRunAt: row.next_run_at,
    cron: row.cron ?? undefined,
    intent: row.intent ?? undefined,
    message: row.message ?? undefined,
    payload: row.payload ? JSON.parse(row.payload) : undefined,
    status: row.status,
    lastRunAt: row.last_run_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
  };
}
