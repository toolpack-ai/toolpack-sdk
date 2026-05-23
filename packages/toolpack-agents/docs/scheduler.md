# Scheduler — SchedulerStore & createSchedulerTools

The scheduler module provides persistent, SQLite-backed job scheduling for `ScheduledChannel`. It lets agents drive their own future invocations — create recurring cron jobs or one-shot run-at jobs, list pending work, cancel or update jobs, all from within the agent's own tool calls.

## Contents

- [Overview](#overview)
- [SchedulerStore](#schedulerstore)
  - [Constructor](#constructor)
  - [create](#create)
  - [get](#get)
  - [list](#list)
  - [getDue](#getdue)
  - [getNextPending](#getnextpending)
  - [update](#update)
  - [cancel](#cancel)
  - [markRunning](#markrunning)
  - [markCompleted](#markcompleted)
  - [markFailed](#markfailed)
  - [resetStuck](#resetstuck)
  - [close](#close)
- [createSchedulerTools](#createschedulertools)
  - [scheduler.create](#schedulercreate)
  - [scheduler.list](#schedulerlist)
  - [scheduler.cancel](#schedulercancel)
  - [scheduler.update](#schedulerupdate)
- [ScheduledJob type](#scheduledjob-type)
- [Job lifecycle](#job-lifecycle)
- [Deduplication](#deduplication)

---

## Overview

```typescript
import {
  SchedulerStore,
  createSchedulerTools,
  ScheduledChannel,
} from '@toolpack-sdk/agents';
import { Toolpack } from 'toolpack-sdk';

// 1. Create the store (SQLite, WAL mode)
const store = new SchedulerStore({ dbPath: './scheduler.db' });

// 2. Expose scheduler tools to the LLM
const toolpack = await Toolpack.init({
  provider: 'anthropic',
  tools: true,
  customTools: [createSchedulerTools(store)],
});

// 3. Wire the store into a ScheduledChannel
const channel = new ScheduledChannel({ name: 'dynamic', store });
```

The agent can then call `scheduler.create`, `scheduler.list`, `scheduler.cancel`, and `scheduler.update` during any invocation to manage its own future runs.

---

## SchedulerStore

SQLite-backed persistent store for scheduled jobs. Uses WAL journal mode and enforces foreign keys.

### Constructor

```typescript
new SchedulerStore({ dbPath?: string })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `dbPath` | `string` | `':memory:'` | Path to the SQLite database file. Use `:memory:` for tests. |

```typescript
// Persistent
const store = new SchedulerStore({ dbPath: './jobs.db' });

// In-memory (tests)
const store = new SchedulerStore();
```

---

### create

```typescript
store.create(opts: CreateJobOptions): CreateJobResult
```

Create a new scheduled job. Exactly one of `cron` (recurring) or `runAt` (one-shot) must be provided.

**Parameters — `CreateJobOptions`:**

| Field | Type | Description |
|---|---|---|
| `cron` | `string` | Cron expression for a recurring job. |
| `runAt` | `Date \| number` | Exact time for a one-shot job (Date or epoch ms). |
| `intent` | `string` | Intent hint forwarded to `AgentInput.intent` on trigger. |
| `message` | `string` | Message forwarded to `AgentInput.message` on trigger. |
| `payload` | `Record<string, unknown>` | Extra data merged into `AgentInput.data` on trigger. |
| `channelName` | `string` | Scopes the job to a specific channel. |

**Returns — `CreateJobResult`:**

```typescript
interface CreateJobResult {
  job: ScheduledJob;
  duplicate: boolean;  // true if an existing pending job matched the dedup key
}
```

**Throws** if neither `cron` nor `runAt` is provided, if both are provided, if the cron expression is invalid, or if `runAt` is `NaN`.

```typescript
// Recurring job
const { job } = store.create({
  intent: 'weekly_report',
  cron: '0 9 * * 1',       // 9am every Monday
  message: 'Generate weekly summary',
  channelName: 'report-channel',
});

// One-shot job
store.create({
  intent: 'onboarding_followup',
  runAt: new Date('2026-06-01T10:00:00Z'),
  payload: { userId: 'usr_123' },
});
```

---

### get

```typescript
store.get(id: string): ScheduledJob | undefined
```

Get a single job by ID. Returns `undefined` if not found.

---

### list

```typescript
store.list(filter?: {
  status?: JobStatus | 'all';
  channelName?: string;
  limit?: number;
}): ScheduledJob[]
```

List jobs, ordered by `nextRunAt` ascending.

| Option | Default | Description |
|---|---|---|
| `status` | `'pending'` | Filter by status. Pass `'all'` to include every status. |
| `channelName` | — | Filter to a specific channel. |
| `limit` | `20` | Maximum number of jobs to return. |

---

### getDue

```typescript
store.getDue(now?: number, channelName?: string): ScheduledJob[]
```

Return all `pending` jobs with `nextRunAt <= now`. Used by `ScheduledChannel` for missed-run recovery and normal polling. Pass `channelName` to scope results.

---

### getNextPending

```typescript
store.getNextPending(channelName?: string): ScheduledJob | undefined
```

Return the single next `pending` job (earliest `nextRunAt`). Used by `ScheduledChannel` to calculate optimal sleep duration between polls.

---

### update

```typescript
store.update(id: string, updates: {
  cron?: string;
  runAt?: Date | number;
  intent?: string;
  message?: string;
  payload?: Record<string, unknown>;
}): ScheduledJob | undefined
```

Update an existing `pending` job. Returns the updated job, or `undefined` if not found.

**Rules:**
- Cannot update a job that is not in `pending` status — throws.
- Cannot provide both `cron` and `runAt` — throws.
- Providing `runAt` clears the `cron` field, converting a recurring job to a one-shot.
- Providing `cron` recalculates `nextRunAt` from the new expression.
- Invalid `cron` or `NaN` `runAt` throw immediately.

---

### cancel

```typescript
store.cancel(id: string): boolean
```

Cancel a `pending` job. Returns `true` if cancelled, `false` if the job was not found or was not in `pending` state. Only `pending` jobs can be cancelled — jobs already `running` are unaffected.

---

### markRunning

```typescript
store.markRunning(id: string): void
```

Set a job's status to `'running'`. Called by `ScheduledChannel` **synchronously** (before any `await`) when a due job fires, ensuring the state change is visible immediately.

---

### markCompleted

```typescript
store.markCompleted(id: string): void
```

Mark a job as completed after a successful agent invocation.

- **Recurring jobs** (`cron` set): status returns to `'pending'`, `nextRunAt` is recalculated from now, `lastError` is cleared.
- **One-shot jobs** (`cron` not set): status becomes `'completed'` permanently.

If the stored cron expression is corrupt at completion time, the job is marked `'failed'` rather than crashing the scheduler loop.

---

### markFailed

```typescript
store.markFailed(id: string, error: string): void
```

Mark a job as failed after an agent invocation throws.

- **Recurring jobs**: status returns to `'pending'`, `nextRunAt` is recalculated, `lastError` is set.
- **One-shot jobs**: status becomes `'failed'` permanently, `lastError` is set.

Recurring jobs with a corrupt cron expression are marked `'failed'` permanently (composite error message).

---

### resetStuck

```typescript
store.resetStuck(channelName?: string): number
```

Reset any `'running'` jobs back to `'pending'`. Returns the number of jobs reset.

**When to call:** `ScheduledChannel` calls this automatically on its **first** `listen()` in a process (crash recovery). A job becomes stuck in `'running'` if the process crashed between `markRunning()` and `markCompleted()`/`markFailed()`. Without this call, stuck jobs would never fire again because `getDue()` only returns `'pending'` jobs.

**Do not call** on subsequent `stop()+listen()` cycles within the same process — in-flight handlers from the previous cycle already hold the job in `'running'` state, and calling `resetStuck()` again would race them back to `'pending'`, causing double-execution.

---

### close

```typescript
store.close(): void
```

Close the underlying SQLite connection. Call this in your shutdown handler if you manage the store's lifecycle manually.

---

## createSchedulerTools

```typescript
import { createSchedulerTools } from '@toolpack-sdk/agents';

createSchedulerTools(store: SchedulerStore): ToolProject
```

Returns a `ToolProject` containing four scheduler tools. Register it as `customTools` when initialising Toolpack so the LLM can manage its own schedule.

```typescript
const store = new SchedulerStore({ dbPath: './scheduler.db' });

const toolpack = await Toolpack.init({
  provider: 'anthropic',
  tools: true,
  customTools: [createSchedulerTools(store)],
});
```

### scheduler.create

Schedule a new recurring or one-shot agent invocation.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `cron` | `string` | one of | Cron expression for a recurring job. E.g. `"0 9 * * 1"` = 9am every Monday. |
| `run_at` | `string` | one of | ISO 8601 timestamp for a one-shot job. E.g. `"2026-07-01T09:00:00Z"`. |
| `intent` | `string` | — | Intent hint forwarded to the agent on trigger. |
| `message` | `string` | — | Message forwarded to the agent on trigger. |
| `channel_name` | `string` | — | Scope this job to a specific channel. |
| `payload` | `object` | — | Extra data merged into `AgentInput.data` on trigger. |

Either `cron` or `run_at` must be provided — not both. The tool validates `run_at` as a proper ISO 8601 timestamp (natural-language strings like `"next Tuesday"` are rejected).

**Returns (string):** Confirmation with job ID and next run time, or an error message.

**Deduplication:** If a `pending` job with the same `(intent, cron, channel_name)` or `(intent, run_at, channel_name)` already exists, the existing job is returned and no duplicate is created.

---

### scheduler.list

List scheduled jobs.

**Parameters:**

| Name | Type | Default | Description |
|---|---|---|---|
| `status` | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled' \| 'all'` | `'pending'` | Filter by status. |
| `channel_name` | `string` | — | Filter by channel name. |
| `limit` | `number` | `10` | Maximum number of results (capped at 50). |

**Returns (string):** A formatted list of jobs with ID, status, type, next run time, and last error (if any).

---

### scheduler.cancel

Cancel a pending job by ID.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `job_id` | `string` | ✓ | ID of the job to cancel. |

**Returns (string):** Confirmation, or an error if the job was not found or not in `pending` state.

---

### scheduler.update

Modify an existing pending job.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `job_id` | `string` | ✓ | ID of the job to update. |
| `cron` | `string` | — | New cron expression. Recalculates `nextRunAt`. |
| `run_at` | `string` | — | New one-shot run time (ISO 8601). Clears `cron`, converting recurring → one-shot. |
| `intent` | `string` | — | New intent. |
| `message` | `string` | — | New message. |
| `payload` | `object` | — | New payload (replaces existing). |

Cannot provide both `cron` and `run_at`. Invalid expressions are rejected with an error message.

**Returns (string):** Confirmation with updated next run time, or an error message.

---

## ScheduledJob type

```typescript
interface ScheduledJob {
  id: string;                       // UUIDv4
  channelName?: string;             // Channel this job belongs to
  nextRunAt: number;                // Next execution time (epoch ms)
  cron?: string;                    // Set for recurring jobs
  intent?: string;                  // Forwarded to AgentInput.intent
  message?: string;                 // Forwarded to AgentInput.message
  payload?: Record<string, unknown>; // Merged into AgentInput.data
  status: JobStatus;                // Current lifecycle state
  lastRunAt?: number;               // Epoch ms of last execution
  lastError?: string;               // Error from last failed execution
  createdAt: number;                // Epoch ms when created
}

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
```

---

## Job lifecycle

```
                    ┌──────────┐
                    │ pending  │◄─────────────────────────────┐
                    └────┬─────┘                              │
                         │ markRunning() (sync, before await) │
                    ┌────▼─────┐                              │
                    │ running  │                              │
                    └────┬─────┘                              │
              ┌──────────┴──────────┐                        │
              │ markCompleted()     │ markFailed()            │
       ┌──────▼──────┐      ┌───────▼──────┐                 │
       │ completed   │      │    failed    │                 │
       │ (one-shot)  │      │  (one-shot)  │                 │
       └─────────────┘      └──────────────┘                 │
                                                             │
  Recurring jobs (cron set):                                 │
    markCompleted() → nextRunAt recalculated → pending ──────┘
    markFailed()    → nextRunAt recalculated → pending ──────┘
```

`cancel()` can only move a job from `pending` → `cancelled`. Once a job is `running` it cannot be cancelled externally — it completes or fails normally.

---

## Deduplication

`store.create()` checks for an existing `pending` job before inserting:

| Job type | Dedup key |
|---|---|
| Recurring (`cron`) | `(intent, cron, channelName)` |
| One-shot (`runAt`) | `(intent, nextRunAt, channelName)` |

If a match is found, the existing job is returned with `duplicate: true` and no new row is written. This makes it safe to call `store.create()` (or `scheduler.create` via the LLM) on every startup without accumulating duplicates.

The same deduplication applies to the static `cron` seed inserted by `ScheduledChannel` in hybrid mode — restarts are idempotent.
