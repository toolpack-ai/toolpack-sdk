import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduledChannel } from './scheduled-channel.js';
import { SchedulerStore } from '../scheduler/scheduler-store.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStore() {
  return new SchedulerStore({ dbPath: ':memory:' });
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe('ScheduledChannel — constructor', () => {
  it('accepts a static cron', () => {
    expect(() => new ScheduledChannel({ cron: '0 9 * * 1-5' })).not.toThrow();
  });

  it('accepts a store only', () => {
    expect(() => new ScheduledChannel({ store: makeStore() })).not.toThrow();
  });

  it('accepts both cron and store', () => {
    expect(() => new ScheduledChannel({ cron: '0 9 * * 1-5', store: makeStore() })).not.toThrow();
  });

  it('throws when neither cron nor store is provided', () => {
    expect(() => new ScheduledChannel({ name: 'x' } as any))
      .toThrow('provide at least one of');
  });

  it('throws on invalid cron expression', () => {
    expect(() => new ScheduledChannel({ cron: 'not-a-cron' }))
      .toThrow('invalid cron expression');
  });

  it('throws when idlePollMs is below 1000ms', () => {
    expect(() => new ScheduledChannel({ store: makeStore(), idlePollMs: 500 }))
      .toThrow('idlePollMs must be at least 1000ms');
  });

  it('throws when idlePollMs is zero', () => {
    expect(() => new ScheduledChannel({ store: makeStore(), idlePollMs: 0 }))
      .toThrow('idlePollMs must be at least 1000ms');
  });

  it('accepts idlePollMs >= 1000', () => {
    expect(() => new ScheduledChannel({ store: makeStore(), idlePollMs: 1000 })).not.toThrow();
  });

  it('sets name from config', () => {
    const channel = new ScheduledChannel({ cron: '* * * * *', name: 'my-channel' });
    expect(channel.name).toBe('my-channel');
  });

  it('isTriggerChannel is true', () => {
    const channel = new ScheduledChannel({ cron: '* * * * *' });
    expect(channel.isTriggerChannel).toBe(true);
  });
});

// ── normalize ─────────────────────────────────────────────────────────────────

describe('ScheduledChannel — normalize', () => {
  it('uses config intent and message when no job provided', () => {
    const channel = new ScheduledChannel({
      cron: '* * * * *',
      intent: 'my_intent',
      message: 'hello',
    });
    const input = channel.normalize(null);
    expect(input.intent).toBe('my_intent');
    expect(input.message).toBe('hello');
  });

  it('falls back to timestamp message when no message configured', () => {
    const channel = new ScheduledChannel({ cron: '* * * * *' });
    const input = channel.normalize(null);
    expect(input.message).toContain('Scheduled task triggered');
  });

  it('prefers job intent/message over config defaults', () => {
    const channel = new ScheduledChannel({
      cron: '* * * * *',
      intent: 'default_intent',
      message: 'default message',
    });
    const input = channel.normalize({
      id: 'job-1',
      intent: 'job_intent',
      message: 'job message',
      cron: '* * * * *',
      nextRunAt: Date.now(),
      status: 'pending',
      createdAt: Date.now(),
    });
    expect(input.intent).toBe('job_intent');
    expect(input.message).toBe('job message');
  });

  it('includes date-keyed conversationId', () => {
    const channel = new ScheduledChannel({ cron: '* * * * *', name: 'test' });
    const input = channel.normalize(null);
    expect(input.conversationId).toMatch(/^scheduled:test:\d{4}-\d{1,2}-\d{1,2}$/);
  });

  it('merges job payload into data', () => {
    const channel = new ScheduledChannel({ cron: '* * * * *' });
    const input = channel.normalize({
      id: 'job-1',
      payload: { region: 'us-east-1' },
      nextRunAt: Date.now(),
      status: 'pending',
      createdAt: Date.now(),
    });
    expect((input.data as any).region).toBe('us-east-1');
    expect((input.data as any).scheduled).toBe(true);
    expect((input.data as any).jobId).toBe('job-1');
  });

  it('includes cron in data', () => {
    const channel = new ScheduledChannel({ cron: '0 9 * * *' });
    const input = channel.normalize(null);
    expect((input.data as any).cron).toBe('0 9 * * *');
  });
});

// ── send ──────────────────────────────────────────────────────────────────────

describe('ScheduledChannel — send', () => {
  it('is a no-op (pure trigger channel)', async () => {
    const channel = new ScheduledChannel({ cron: '* * * * *' });
    await expect(channel.send({ output: 'result' })).resolves.toBeUndefined();
  });
});

// ── listen / stop (static mode) ───────────────────────────────────────────────

describe('ScheduledChannel — listen/stop (static)', () => {
  it('listen does not throw', async () => {
    const channel = new ScheduledChannel({ cron: '0 9 * * 1-5' });
    expect(() => channel.listen()).not.toThrow();
    await channel.stop();
  });

  it('stop clears the timer gracefully', async () => {
    const channel = new ScheduledChannel({ cron: '0 9 * * 1-5' });
    channel.listen();
    await expect(channel.stop()).resolves.toBeUndefined();
  });

  it('stop before listen does not throw', async () => {
    const channel = new ScheduledChannel({ cron: '0 9 * * 1-5' });
    await expect(channel.stop()).resolves.toBeUndefined();
  });
});

// ── listen (store mode) ───────────────────────────────────────────────────────

describe('ScheduledChannel — listen (store mode)', () => {
  let store: SchedulerStore;

  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('seeds static cron into the store on listen()', async () => {
    const channel = new ScheduledChannel({
      name: 'hybrid',
      cron: '0 9 * * 1-5',
      intent: 'morning',
      store,
    });
    channel.listen();
    await channel.stop();

    const jobs = store.list({ status: 'pending' });
    expect(jobs.length).toBe(1);
    expect(jobs[0].cron).toBe('0 9 * * 1-5');
    expect(jobs[0].intent).toBe('morning');
  });

  it('does not duplicate the seeded job on repeated listen() calls', async () => {
    const channel = new ScheduledChannel({
      name: 'hybrid',
      cron: '0 9 * * 1-5',
      store,
    });
    channel.listen();
    await channel.stop();
    channel.listen();
    await channel.stop();

    const jobs = store.list({ status: 'pending' });
    expect(jobs.length).toBe(1);
  });

  it('executes overdue jobs immediately on listen() (missed-run recovery)', async () => {
    // Create a job that was due in the past — must be scoped to the channel's name
    const pastTime = Date.now() - 10_000;
    store.create({ intent: 'overdue', runAt: new Date(pastTime), channelName: 'recovery' });

    const triggered: string[] = [];
    const channel = new ScheduledChannel({ name: 'recovery', store });
    channel.onMessage(async input => {
      triggered.push(input.intent ?? 'none');
    });

    channel.listen();
    // Give the async trigger a moment to fire
    await new Promise(r => setTimeout(r, 50));
    await channel.stop();

    expect(triggered).toContain('overdue');
  });
});

// ── resetStuck recovery ───────────────────────────────────────────────────────

describe('ScheduledChannel — resetStuck recovery on listen()', () => {
  let store: SchedulerStore;

  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('resets running jobs to pending on listen() so they are retried', async () => {
    const { job } = store.create({ cron: '* * * * *', intent: 'crasher', channelName: 'recover' });
    store.markRunning(job.id); // simulate a crash mid-execution

    expect(store.get(job.id)?.status).toBe('running');

    const triggered: string[] = [];
    const channel = new ScheduledChannel({ name: 'recover', store });
    channel.onMessage(async input => { triggered.push(input.intent ?? 'none'); });

    // getDue won't find a running job — but resetStuck should promote it back to pending first.
    // The job's nextRunAt is in the future (cron-based), so it won't fire immediately.
    // What matters is that status is now 'pending' again.
    channel.listen();
    await channel.stop();

    expect(store.get(job.id)?.status).toBe('pending');
  });

  it('recovers a stuck + overdue job and executes it', async () => {
    // Insert a job directly with a past nextRunAt and status 'running' (simulated crash)
    const pastTime = Date.now() - 5_000;
    store['db'].prepare(
      `INSERT INTO scheduled_jobs (id, channel_name, next_run_at, intent, status, created_at)
       VALUES ('stuck-1', 'r2', @pastTime, 'stuck_intent', 'running', @now)`
    ).run({ pastTime, now: Date.now() });

    const triggered: string[] = [];
    const channel = new ScheduledChannel({ name: 'r2', store });
    channel.onMessage(async input => { triggered.push(input.intent ?? 'none'); });

    channel.listen();
    await new Promise(r => setTimeout(r, 50)); // let overdue recovery fire
    await channel.stop();

    expect(triggered).toContain('stuck_intent');
  });
});

// ── Double-listen / generation guard ─────────────────────────────────────────

describe('ScheduledChannel — generation guard (stop + re-listen)', () => {
  let store: SchedulerStore;

  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('stop() + listen() does not create duplicate timer loops', async () => {
    const triggerCount: number[] = [];
    const channel = new ScheduledChannel({ name: 'gen-test', store });
    channel.onMessage(async () => { triggerCount.push(1); });

    // Cycle listen/stop several times
    channel.listen();
    await channel.stop();
    channel.listen();
    await channel.stop();
    channel.listen();
    await channel.stop();

    // Internal _generation should have been incremented once per listen() call
    expect((channel as any)._generation).toBe(3);
    // No timers left active after final stop
    expect((channel as any).timer).toBeUndefined();
  });

  it('stop() + listen() does NOT double-execute an in-flight overdue job', async () => {
    // Create an overdue job
    const pastTime = Date.now() - 5_000;
    store['db'].prepare(
      `INSERT INTO scheduled_jobs (id, channel_name, next_run_at, intent, status, created_at)
       VALUES ('inflight-1', 'dbl', @pastTime, 'one_shot', 'pending', @now)`
    ).run({ pastTime, now: Date.now() });

    const executions: string[] = [];
    // Use a slow handler so the job is still "in-flight" when stop+listen fires
    const channel = new ScheduledChannel({ name: 'dbl', store });
    channel.onMessage(async input => {
      await new Promise(r => setTimeout(r, 80)); // simulate slow agent
      executions.push(input.intent ?? 'none');
    });

    // listen() #1 — fires the overdue job (markRunning is called synchronously before handler await)
    channel.listen();
    // stop() + listen() #2 immediately — before the handler completes.
    // resetStuck is skipped (gen > 1) so the in-flight job is NOT reset to pending.
    await channel.stop();
    channel.listen();

    // Wait for the original handler to complete
    await new Promise(r => setTimeout(r, 150));
    await channel.stop();

    // Job should have been executed exactly once, not twice
    expect(executions.length).toBe(1);
    expect(executions[0]).toBe('one_shot');
  });
});

// ── No handler registered ─────────────────────────────────────────────────────

describe('ScheduledChannel — no handler registered', () => {
  let store: SchedulerStore;

  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('store mode: marks job failed (not silently completed) when no handler is set', async () => {
    const pastTime = Date.now() - 5_000;
    const { job } = store.create({
      intent: 'no-handler',
      runAt: new Date(pastTime),
      channelName: 'nh',
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channel = new ScheduledChannel({ name: 'nh', store });
    // Deliberately do NOT call onMessage()

    channel.listen();
    await new Promise(r => setTimeout(r, 50));
    await channel.stop();

    expect(store.get(job.id)?.status).toBe('failed');
    expect(store.get(job.id)?.lastError).toContain('No message handler');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('static mode: logs a warning and skips the trigger when no handler is set', async () => {
    // We can't easily fire a static cron in a test, but we can call _triggerStatic directly
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channel = new ScheduledChannel({ cron: '* * * * *' });
    // No onMessage() call

    await (channel as any)._triggerStatic();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('no message handler');
    warn.mockRestore();
  });
});

// ── store without name warning ────────────────────────────────────────────────

describe('ScheduledChannel — store without name warning', () => {
  it('warns to console when store is provided without a name', () => {
    const store = makeStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      new ScheduledChannel({ store });
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain('without a `name`');
    } finally {
      warn.mockRestore();
      store.close();
    }
  });

  it('does not warn when name is provided with store', () => {
    const store = makeStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      new ScheduledChannel({ name: 'named', store });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      store.close();
    }
  });
});

// ── Cron expression support ───────────────────────────────────────────────────

describe('ScheduledChannel — cron expressions', () => {
  const valid = [
    '0 9 * * 1-5',     // 9am weekdays
    '*/15 * * * *',    // every 15 min
    '0 9-17 * * *',    // 9am–5pm daily
    '0,15,30,45 * * * *', // every 15 min via list
    '0-30/5 * * * *',  // every 5 min in first half
    '*/15 9-17 * * 1-5', // every 15 min business hours
    '0 10 * * 1,3,5',  // Mon/Wed/Fri 10am
    '0 0 1,15 * *',    // 1st and 15th
    '0 9 1 1,6,12 *',  // quarterly
    '0 0 * * *',       // midnight
  ];

  for (const expr of valid) {
    it(`accepts: ${expr}`, () => {
      expect(() => new ScheduledChannel({ cron: expr })).not.toThrow();
    });
  }

  it('rejects invalid expressions', () => {
    expect(() => new ScheduledChannel({ cron: 'invalid' })).toThrow('invalid cron expression');
  });
});
