import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchedulerStore } from './scheduler-store.js';

function makeStore() {
  return new SchedulerStore({ dbPath: ':memory:' });
}

describe('SchedulerStore — create', () => {
  let store: SchedulerStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('creates a recurring job with cron', () => {
    const { job, duplicate } = store.create({ cron: '0 9 * * 1-5', intent: 'report' });
    expect(duplicate).toBe(false);
    expect(job.id).toBeDefined();
    expect(job.cron).toBe('0 9 * * 1-5');
    expect(job.intent).toBe('report');
    expect(job.status).toBe('pending');
    expect(job.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('creates a one-shot job with runAt', () => {
    const runAt = new Date(Date.now() + 60_000);
    const { job, duplicate } = store.create({ runAt, intent: 'followup' });
    expect(duplicate).toBe(false);
    expect(job.cron).toBeUndefined();
    expect(job.nextRunAt).toBe(runAt.getTime());
  });

  it('throws when neither cron nor runAt is provided', () => {
    expect(() => store.create({ intent: 'x' })).toThrow();
  });

  it('throws when both cron and runAt are provided', () => {
    expect(() => store.create({ cron: '* * * * *', runAt: new Date() })).toThrow();
  });

  it('throws on invalid cron', () => {
    expect(() => store.create({ cron: 'bad-cron' })).toThrow('invalid cron');
  });

  it('deduplicates recurring jobs by (intent, cron, channelName)', () => {
    store.create({ cron: '0 9 * * 1', intent: 'report', channelName: 'daily' });
    const { job: dup, duplicate } = store.create({
      cron: '0 9 * * 1',
      intent: 'report',
      channelName: 'daily',
    });
    expect(duplicate).toBe(true);
    expect(store.list().length).toBe(1);
    expect(dup.id).toBeDefined();
  });

  it('deduplicates one-shot jobs by (intent, runAt, channelName)', () => {
    const runAt = new Date(Date.now() + 60_000);
    store.create({ runAt, intent: 'ping' });
    const { duplicate } = store.create({ runAt, intent: 'ping' });
    expect(duplicate).toBe(true);
    expect(store.list().length).toBe(1);
  });

  it('does not dedup jobs with different intent', () => {
    store.create({ cron: '* * * * *', intent: 'a' });
    const { duplicate } = store.create({ cron: '* * * * *', intent: 'b' });
    expect(duplicate).toBe(false);
    expect(store.list().length).toBe(2);
  });

  it('does not dedup jobs on different channels', () => {
    store.create({ cron: '* * * * *', intent: 'x', channelName: 'ch1' });
    const { duplicate } = store.create({ cron: '* * * * *', intent: 'x', channelName: 'ch2' });
    expect(duplicate).toBe(false);
  });

  it('stores payload as JSON', () => {
    const { job } = store.create({
      cron: '* * * * *',
      payload: { region: 'us-east-1', count: 42 },
    });
    expect(job.payload).toEqual({ region: 'us-east-1', count: 42 });
  });
});

describe('SchedulerStore — list / get', () => {
  let store: SchedulerStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('lists pending jobs by default', () => {
    store.create({ cron: '* * * * *', intent: 'a' });
    store.create({ cron: '* * * * *', intent: 'b' });
    expect(store.list().length).toBe(2);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) store.create({ cron: '* * * * *', intent: `j${i}` });
    expect(store.list({ limit: 3 }).length).toBe(3);
  });

  it('filters by channelName', () => {
    store.create({ cron: '* * * * *', intent: 'a', channelName: 'ch1' });
    store.create({ cron: '* * * * *', intent: 'b', channelName: 'ch2' });
    expect(store.list({ channelName: 'ch1' }).length).toBe(1);
  });

  it('returns all statuses with status="all"', () => {
    const { job } = store.create({ cron: '* * * * *' });
    store.cancel(job.id);
    expect(store.list({ status: 'all' }).length).toBe(1);
    expect(store.list({ status: 'pending' }).length).toBe(0);
  });

  it('get returns a job by id', () => {
    const { job } = store.create({ cron: '* * * * *', intent: 'hi' });
    expect(store.get(job.id)?.intent).toBe('hi');
  });

  it('get returns undefined for unknown id', () => {
    expect(store.get('no-such-id')).toBeUndefined();
  });
});

describe('SchedulerStore — getDue / getNextPending', () => {
  let store: SchedulerStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('getDue returns jobs with nextRunAt <= now', () => {
    const past = Date.now() - 5_000;
    store['db'].prepare(
      `INSERT INTO scheduled_jobs (id, next_run_at, status, created_at) VALUES ('j1', @past, 'pending', @now)`
    ).run({ past, now: Date.now() });

    const due = store.getDue();
    expect(due.length).toBe(1);
    expect(due[0].id).toBe('j1');
  });

  it('getDue excludes future jobs', () => {
    store.create({ cron: '0 9 * * 1-5' }); // future
    expect(store.getDue()).toHaveLength(0);
  });

  it('getNextPending returns the earliest pending job', () => {
    store.create({ cron: '0 9 * * 1', intent: 'a' });
    store.create({ cron: '0 10 * * 1', intent: 'b' });
    const next = store.getNextPending();
    expect(next).toBeDefined();
    expect(['a', 'b']).toContain(next!.intent);
  });

  it('getNextPending filters by channelName', () => {
    store.create({ cron: '* * * * *', intent: 'a', channelName: 'ch1' });
    store.create({ cron: '* * * * *', intent: 'b', channelName: 'ch2' });
    const next = store.getNextPending('ch1');
    expect(next?.intent).toBe('a');
  });

  it('getNextPending returns undefined when no pending jobs', () => {
    expect(store.getNextPending()).toBeUndefined();
  });
});

describe('SchedulerStore — cancel', () => {
  let store: SchedulerStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('cancels a pending job', () => {
    const { job } = store.create({ cron: '* * * * *' });
    expect(store.cancel(job.id)).toBe(true);
    expect(store.get(job.id)?.status).toBe('cancelled');
  });

  it('returns false for unknown id', () => {
    expect(store.cancel('no-such-id')).toBe(false);
  });

  it('returns false for already-cancelled job', () => {
    const { job } = store.create({ cron: '* * * * *' });
    store.cancel(job.id);
    expect(store.cancel(job.id)).toBe(false);
  });
});

describe('SchedulerStore — update', () => {
  let store: SchedulerStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('updates message and intent', () => {
    const { job } = store.create({ cron: '* * * * *', intent: 'old', message: 'old msg' });
    const updated = store.update(job.id, { intent: 'new', message: 'new msg' });
    expect(updated?.intent).toBe('new');
    expect(updated?.message).toBe('new msg');
  });

  it('updates cron and recalculates nextRunAt', () => {
    const { job } = store.create({ cron: '0 9 * * 1' });
    const before = job.nextRunAt;
    const updated = store.update(job.id, { cron: '0 10 * * 1' });
    expect(updated?.cron).toBe('0 10 * * 1');
    expect(updated?.nextRunAt).not.toBe(before);
  });

  it('updates runAt for one-shot job', () => {
    const original = new Date(Date.now() + 60_000);
    const { job } = store.create({ runAt: original });
    const newRunAt = new Date(Date.now() + 120_000);
    const updated = store.update(job.id, { runAt: newRunAt });
    expect(updated?.nextRunAt).toBe(newRunAt.getTime());
  });

  it('returns undefined for unknown id', () => {
    expect(store.update('no-such-id', { message: 'x' })).toBeUndefined();
  });

  it('throws when updating a non-pending job', () => {
    const { job } = store.create({ cron: '* * * * *' });
    store.cancel(job.id);
    expect(() => store.update(job.id, { message: 'x' })).toThrow("status is 'cancelled'");
  });

  it('throws when runAt is NaN', () => {
    const { job } = store.create({ cron: '* * * * *' });
    expect(() => store.update(job.id, { runAt: NaN })).toThrow('invalid runAt');
  });

  it('updating runAt on a recurring job clears cron (converts to one-shot)', () => {
    const { job } = store.create({ cron: '* * * * *' });
    expect(job.cron).toBe('* * * * *');

    const newRunAt = new Date(Date.now() + 60_000);
    const updated = store.update(job.id, { runAt: newRunAt });

    // cron must be cleared so markCompleted does not reschedule it
    expect(updated?.cron).toBeUndefined();
    expect(updated?.nextRunAt).toBe(newRunAt.getTime());
  });

  it('a recurring job updated with runAt only fires once then stays completed', () => {
    const { job } = store.create({ cron: '* * * * *' });
    const newRunAt = new Date(Date.now() + 60_000);
    const updated = store.update(job.id, { runAt: newRunAt })!;

    store.markRunning(updated.id);
    store.markCompleted(updated.id);

    const final = store.get(updated.id)!;
    expect(final.status).toBe('completed'); // NOT pending — no cron to reschedule
  });
});

describe('SchedulerStore — lifecycle (markRunning / markCompleted / markFailed)', () => {
  let store: SchedulerStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('markRunning sets status to running', () => {
    const { job } = store.create({ cron: '* * * * *' });
    store.markRunning(job.id);
    expect(store.get(job.id)?.status).toBe('running');
  });

  it('markCompleted on one-shot job sets status to completed', () => {
    const { job } = store.create({ runAt: new Date(Date.now() + 1000) });
    store.markRunning(job.id);
    store.markCompleted(job.id);
    const updated = store.get(job.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.lastRunAt).toBeDefined();
    expect(updated.lastError).toBeUndefined();
  });

  it('markCompleted on recurring job resets to pending with new nextRunAt', () => {
    const { job } = store.create({ cron: '* * * * *' });
    store.markRunning(job.id);
    store.markCompleted(job.id);
    const updated = store.get(job.id)!;
    expect(updated.status).toBe('pending');
    // nextRunAt should be in the future (not compared to original to avoid minute-boundary flakiness)
    expect(updated.nextRunAt).toBeGreaterThan(Date.now());
    expect(updated.lastRunAt).toBeDefined();
  });

  it('markFailed on one-shot job sets status to failed', () => {
    const { job } = store.create({ runAt: new Date(Date.now() + 1000) });
    store.markRunning(job.id);
    store.markFailed(job.id, 'timeout');
    const updated = store.get(job.id)!;
    expect(updated.status).toBe('failed');
    expect(updated.lastError).toBe('timeout');
  });

  it('markFailed on recurring job reschedules', () => {
    const { job } = store.create({ cron: '* * * * *' });
    store.markRunning(job.id);
    store.markFailed(job.id, 'network error');
    const updated = store.get(job.id)!;
    expect(updated.status).toBe('pending');
    expect(updated.lastError).toBe('network error');
    expect(updated.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('markCompleted on a job with corrupt cron marks it failed instead of throwing', () => {
    // Insert a job directly with an invalid cron to simulate data corruption
    store['db'].prepare(
      `INSERT INTO scheduled_jobs (id, cron, next_run_at, status, created_at)
       VALUES ('corrupt-1', 'not-a-cron', @nextRunAt, 'running', @now)`
    ).run({ nextRunAt: Date.now() + 60_000, now: Date.now() });

    // Should not throw; should record the failure instead
    expect(() => store.markCompleted('corrupt-1')).not.toThrow();
    const job = store.get('corrupt-1')!;
    expect(job.status).toBe('failed');
    expect(job.lastError).toContain('corrupt cron');
  });

  it('markFailed on a job with corrupt cron marks it permanently failed instead of throwing', () => {
    store['db'].prepare(
      `INSERT INTO scheduled_jobs (id, cron, next_run_at, status, created_at)
       VALUES ('corrupt-2', 'bad!!cron', @nextRunAt, 'running', @now)`
    ).run({ nextRunAt: Date.now() + 60_000, now: Date.now() });

    expect(() => store.markFailed('corrupt-2', 'agent error')).not.toThrow();
    const job = store.get('corrupt-2')!;
    expect(job.status).toBe('failed');
    expect(job.lastError).toContain('corrupt cron');
  });
});
