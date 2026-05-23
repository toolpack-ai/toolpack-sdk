import type { ToolProject } from 'toolpack-sdk';
import { SchedulerStore } from './scheduler-store.js';

/**
 * Creates a `ToolProject` that exposes four scheduler tools to the LLM.
 *
 * Register the returned project as `customTools` when initialising Toolpack so
 * the agent can manage its own schedule autonomously.
 *
 * @example
 * ```ts
 * const store = new SchedulerStore({ dbPath: './scheduler.db' });
 *
 * const toolpack = await Toolpack.init({
 *   provider: 'openai',
 *   tools: true,
 *   customTools: [createSchedulerTools(store)],
 * });
 * ```
 *
 * Tools exposed:
 * - `scheduler.create`  — schedule a new recurring or one-shot invocation
 * - `scheduler.list`    — list pending/all jobs
 * - `scheduler.cancel`  — cancel a pending job
 * - `scheduler.update`  — modify an existing pending job
 */
export function createSchedulerTools(store: SchedulerStore): ToolProject {
  return {
    manifest: {
      key: 'scheduler',
      name: 'scheduler',
      displayName: 'Scheduler',
      version: '1.0.0',
      description: 'Tools for the agent to manage its own scheduled invocations.',
      category: 'scheduler',
      tools: ['scheduler.create', 'scheduler.list', 'scheduler.cancel', 'scheduler.update'],
    },
    tools: [

      // ── scheduler.create ──────────────────────────────────────────────────
      {
        name: 'scheduler.create',
        displayName: 'Schedule Job',
        category: 'scheduler',
        description: [
          'Schedule a future agent invocation.',
          'Provide `cron` for a recurring job or `run_at` (ISO timestamp) for a one-shot job.',
          'The scheduler deduplicates: if a pending job with the same intent + cron (or run_at) + channel already exists, it returns the existing job without creating a duplicate.',
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: 'Intent hint forwarded to the agent on trigger (e.g. "weekly_report").',
            },
            message: {
              type: 'string',
              description: 'Message forwarded to the agent on trigger.',
            },
            cron: {
              type: 'string',
              description: 'Cron expression for recurring jobs. E.g. "0 9 * * 1" = 9am every Monday.',
            },
            run_at: {
              type: 'string',
              description: 'ISO 8601 timestamp for a one-shot job. E.g. "2026-07-01T09:00:00Z".',
            },
            channel_name: {
              type: 'string',
              description: 'Optional channel name to scope this job.',
            },
            payload: {
              type: 'object',
              description: 'Optional extra data merged into AgentInput.data on trigger.',
            },
          },
          required: [],
        },
        execute: async (args: Record<string, any>): Promise<string> => {
          if (!args.cron && !args.run_at) {
            return 'Error: provide either `cron` (recurring) or `run_at` (one-shot).';
          }
          if (args.cron && args.run_at) {
            return 'Error: provide `cron` OR `run_at`, not both.';
          }

          // Validate run_at before handing it to the store (catches "next Tuesday"-style strings)
          if (args.run_at) {
            const parsed = new Date(args.run_at);
            if (isNaN(parsed.getTime())) {
              return `Error: invalid run_at value "${args.run_at}". Provide an ISO 8601 timestamp, e.g. "2026-07-01T09:00:00Z".`;
            }
          }

          try {
            const { job, duplicate } = store.create({
              intent: args.intent,
              message: args.message,
              cron: args.cron,
              runAt: args.run_at ? new Date(args.run_at) : undefined,
              channelName: args.channel_name,
              payload: args.payload,
            });

            if (duplicate) {
              return [
                `A pending job with the same schedule already exists (id: ${job.id}).`,
                `Next run: ${new Date(job.nextRunAt).toISOString()}`,
                'No new job was created.',
              ].join(' ');
            }

            return [
              `Job scheduled (id: ${job.id}).`,
              job.cron
                ? `Recurring — cron: "${job.cron}". Next run: ${new Date(job.nextRunAt).toISOString()}.`
                : `One-shot — runs at: ${new Date(job.nextRunAt).toISOString()}.`,
            ].join(' ');
          } catch (err) {
            return `Error: ${(err as Error).message}`;
          }
        },
      },

      // ── scheduler.list ────────────────────────────────────────────────────
      {
        name: 'scheduler.list',
        displayName: 'List Scheduled Jobs',
        category: 'scheduler',
        description: 'List scheduled jobs. Defaults to pending jobs only. Use status="all" to include completed/failed/cancelled.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'all'],
              description: 'Filter by job status. Default: "pending".',
            },
            channel_name: {
              type: 'string',
              description: 'Filter by channel name.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of jobs to return (default: 10, max: 50).',
            },
          },
          required: [],
        },
        execute: async (args: Record<string, any>): Promise<string> => {
          const limit = Math.min(args.limit ?? 10, 50);
          const jobs = store.list({
            status: args.status ?? 'pending',
            channelName: args.channel_name,
            limit,
          });

          if (jobs.length === 0) {
            return 'No scheduled jobs found.';
          }

          const lines = jobs.map(j => {
            const nextRun = new Date(j.nextRunAt).toISOString();
            const type = j.cron ? `recurring (${j.cron})` : 'one-shot';
            const intent = j.intent ? ` intent="${j.intent}"` : '';
            const error = j.lastError ? ` [last_error: ${j.lastError}]` : '';
            return `- id=${j.id} status=${j.status} type=${type}${intent} next_run=${nextRun}${error}`;
          });

          return [`${jobs.length} job(s):`, ...lines].join('\n');
        },
      },

      // ── scheduler.cancel ──────────────────────────────────────────────────
      {
        name: 'scheduler.cancel',
        displayName: 'Cancel Scheduled Job',
        category: 'scheduler',
        description: 'Cancel a pending scheduled job by its ID.',
        parameters: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'The ID of the job to cancel.',
            },
          },
          required: ['job_id'],
        },
        execute: async (args: Record<string, any>): Promise<string> => {
          if (!args.job_id) return 'Error: job_id is required.';

          const cancelled = store.cancel(args.job_id);
          return cancelled
            ? `Job ${args.job_id} has been cancelled.`
            : `Job ${args.job_id} not found or is not in pending state.`;
        },
      },

      // ── scheduler.update ──────────────────────────────────────────────────
      {
        name: 'scheduler.update',
        displayName: 'Update Scheduled Job',
        category: 'scheduler',
        description: 'Modify an existing pending job — change its cron expression, run time, intent, message, or payload.',
        parameters: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'The ID of the job to update.',
            },
            cron: {
              type: 'string',
              description: 'New cron expression (updates nextRunAt automatically).',
            },
            run_at: {
              type: 'string',
              description: 'Override the next run time (ISO 8601). Also clears the cron expression, converting the job to a one-shot. Use `cron` if you want the job to remain recurring.',
            },
            intent: {
              type: 'string',
              description: 'New intent.',
            },
            message: {
              type: 'string',
              description: 'New message.',
            },
            payload: {
              type: 'object',
              description: 'New payload (replaces existing).',
            },
          },
          required: ['job_id'],
        },
        execute: async (args: Record<string, any>): Promise<string> => {
          if (!args.job_id) return 'Error: job_id is required.';
          if (args.cron && args.run_at) {
            return 'Error: provide `cron` OR `run_at`, not both.';
          }

          // Validate run_at before handing it to the store
          if (args.run_at) {
            const parsed = new Date(args.run_at);
            if (isNaN(parsed.getTime())) {
              return `Error: invalid run_at value "${args.run_at}". Provide an ISO 8601 timestamp, e.g. "2026-07-01T09:00:00Z".`;
            }
          }

          try {
            const updated = store.update(args.job_id, {
              cron: args.cron,
              runAt: args.run_at ? new Date(args.run_at) : undefined,
              intent: args.intent,
              message: args.message,
              payload: args.payload,
            });

            if (!updated) return `Job ${args.job_id} not found.`;

            return [
              `Job ${updated.id} updated.`,
              `Next run: ${new Date(updated.nextRunAt).toISOString()}.`,
            ].join(' ');
          } catch (err) {
            return `Error: ${(err as Error).message}`;
          }
        },
      },
    ],
  };
}
