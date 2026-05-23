/**
 * Scheduler types — shared across SchedulerStore, scheduler tools, and ScheduledChannel.
 */

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * A single scheduled job record.
 */
export interface ScheduledJob {
  /** Unique identifier (UUIDv4). */
  id: string;

  /** Name of the channel this job belongs to (for multi-channel routing). */
  channelName?: string;

  /** Next execution time in epoch ms. */
  nextRunAt: number;

  /**
   * Cron expression for recurring jobs.
   * Undefined for one-shot jobs.
   */
  cron?: string;

  /** Intent hint forwarded to AgentInput. */
  intent?: string;

  /** Message forwarded to AgentInput. */
  message?: string;

  /** Extra data merged into AgentInput.data. */
  payload?: Record<string, unknown>;

  /** Current lifecycle status. */
  status: JobStatus;

  /** Epoch ms of the last execution. */
  lastRunAt?: number;

  /** Error message from the last failed execution. */
  lastError?: string;

  /** Epoch ms when the job was created. */
  createdAt: number;
}

/**
 * Options for creating a new scheduled job.
 * Exactly one of `cron` (recurring) or `runAt` (one-shot) must be provided.
 */
export interface CreateJobOptions {
  /** Channel name to scope this job to. */
  channelName?: string;

  /** Intent hint for the agent. */
  intent?: string;

  /** Message for the agent. */
  message?: string;

  /** Extra data merged into AgentInput.data. */
  payload?: Record<string, unknown>;

  /**
   * Cron expression for recurring jobs.
   * Supports 5-field (min hour dom month dow) and 6-field (sec min hour dom month dow).
   */
  cron?: string;

  /**
   * Exact time for one-shot jobs.
   * Accepts a Date object or epoch ms.
   */
  runAt?: Date | number;
}

/**
 * Result of a create operation — includes a duplicate flag if dedup matched.
 */
export interface CreateJobResult {
  job: ScheduledJob;
  /** True if an existing pending job matched the dedup key (job was not re-created). */
  duplicate: boolean;
}
