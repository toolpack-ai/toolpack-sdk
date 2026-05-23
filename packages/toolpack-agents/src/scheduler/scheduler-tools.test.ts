import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchedulerStore } from './scheduler-store.js';
import { createSchedulerTools } from './scheduler-tools.js';

function makeProject() {
  const store = new SchedulerStore({ dbPath: ':memory:' });
  const project = createSchedulerTools(store);
  const toolMap = Object.fromEntries(project.tools.map(t => [t.name, t]));
  return { store, project, toolMap };
}

function exec(toolMap: Record<string, any>, name: string, args: Record<string, any>) {
  return toolMap[name].execute(args) as Promise<string>;
}

// ── Manifest ──────────────────────────────────────────────────────────────────

describe('createSchedulerTools — manifest', () => {
  it('returns a ToolProject with 4 tools', () => {
    const { project } = makeProject();
    expect(project.manifest.key).toBe('scheduler');
    expect(project.tools.length).toBe(4);
    const names = project.tools.map(t => t.name);
    expect(names).toContain('scheduler.create');
    expect(names).toContain('scheduler.list');
    expect(names).toContain('scheduler.cancel');
    expect(names).toContain('scheduler.update');
  });
});

// ── scheduler.create ──────────────────────────────────────────────────────────

describe('scheduler.create tool', () => {
  let store: SchedulerStore;
  let toolMap: Record<string, any>;
  beforeEach(() => { ({ store, toolMap } = makeProject()); });
  afterEach(() => { store.close(); });

  it('creates a recurring job', async () => {
    const result = await exec(toolMap, 'scheduler.create', {
      cron: '0 9 * * 1',
      intent: 'weekly_report',
    });
    expect(result).toContain('Job scheduled');
    expect(result).toContain('Recurring');
    expect(store.list().length).toBe(1);
  });

  it('creates a one-shot job', async () => {
    const runAt = new Date(Date.now() + 60_000).toISOString();
    const result = await exec(toolMap, 'scheduler.create', { run_at: runAt, intent: 'ping' });
    expect(result).toContain('Job scheduled');
    expect(result).toContain('One-shot');
  });

  it('returns error when neither cron nor run_at provided', async () => {
    const result = await exec(toolMap, 'scheduler.create', { intent: 'x' });
    expect(result).toContain('Error');
    expect(result).toContain('cron');
  });

  it('returns error when both cron and run_at provided', async () => {
    const result = await exec(toolMap, 'scheduler.create', {
      cron: '* * * * *',
      run_at: new Date(Date.now() + 1000).toISOString(),
    });
    expect(result).toContain('Error');
  });

  it('reports duplicate without creating a new job', async () => {
    await exec(toolMap, 'scheduler.create', { cron: '0 9 * * 1', intent: 'report' });
    const result = await exec(toolMap, 'scheduler.create', { cron: '0 9 * * 1', intent: 'report' });
    expect(result).toContain('already exists');
    expect(store.list().length).toBe(1);
  });

  it('returns error for invalid cron', async () => {
    const result = await exec(toolMap, 'scheduler.create', { cron: 'bad' });
    expect(result).toContain('Error');
  });

  it('returns error for invalid run_at (non-ISO string)', async () => {
    const result = await exec(toolMap, 'scheduler.create', { run_at: 'next Tuesday' });
    expect(result).toContain('Error');
    expect(result).toContain('invalid run_at');
    expect(store.list().length).toBe(0); // no job created
  });
});

// ── scheduler.list ────────────────────────────────────────────────────────────

describe('scheduler.list tool', () => {
  let store: SchedulerStore;
  let toolMap: Record<string, any>;
  beforeEach(() => { ({ store, toolMap } = makeProject()); });
  afterEach(() => { store.close(); });

  it('returns "No scheduled jobs" when empty', async () => {
    const result = await exec(toolMap, 'scheduler.list', {});
    expect(result).toContain('No scheduled jobs');
  });

  it('lists pending jobs', async () => {
    store.create({ cron: '* * * * *', intent: 'alpha' });
    store.create({ cron: '* * * * *', intent: 'beta' });
    const result = await exec(toolMap, 'scheduler.list', {});
    expect(result).toContain('2 job(s)');
    expect(result).toContain('alpha');
    expect(result).toContain('beta');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) store.create({ cron: '* * * * *', intent: `j${i}` });
    const result = await exec(toolMap, 'scheduler.list', { limit: 2 });
    expect(result).toContain('2 job(s)');
  });

  it('caps limit at 50', async () => {
    // Insert 55 jobs and verify the cap is enforced
    for (let i = 0; i < 55; i++) store.create({ cron: '* * * * *', intent: `cap${i}` });
    const result = await exec(toolMap, 'scheduler.list', { limit: 999 });
    // Should return at most 50 results
    const match = result.match(/^(\d+) job\(s\)/m);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeLessThanOrEqual(50);
  });

  it('shows all statuses with status="all"', async () => {
    const { job } = store.create({ cron: '* * * * *', intent: 'x' });
    store.cancel(job.id);
    const result = await exec(toolMap, 'scheduler.list', { status: 'all' });
    expect(result).toContain('cancelled');
  });

  it('filters by channel_name', async () => {
    store.create({ cron: '* * * * *', intent: 'ch1_only', channelName: 'ch1' });
    store.create({ cron: '* * * * *', intent: 'ch2_only', channelName: 'ch2' });
    const result = await exec(toolMap, 'scheduler.list', { channel_name: 'ch1' });
    expect(result).toContain('1 job(s)');
    expect(result).toContain('ch1_only');
    expect(result).not.toContain('ch2_only');
  });
});

// ── scheduler.cancel ──────────────────────────────────────────────────────────

describe('scheduler.cancel tool', () => {
  let store: SchedulerStore;
  let toolMap: Record<string, any>;
  beforeEach(() => { ({ store, toolMap } = makeProject()); });
  afterEach(() => { store.close(); });

  it('cancels a pending job', async () => {
    const { job } = store.create({ cron: '* * * * *' });
    const result = await exec(toolMap, 'scheduler.cancel', { job_id: job.id });
    expect(result).toContain('cancelled');
    expect(store.get(job.id)?.status).toBe('cancelled');
  });

  it('returns error message for unknown id', async () => {
    const result = await exec(toolMap, 'scheduler.cancel', { job_id: 'no-such-id' });
    expect(result).toContain('not found');
  });

  it('returns error when job_id missing', async () => {
    const result = await exec(toolMap, 'scheduler.cancel', {});
    expect(result).toContain('Error');
  });
});

// ── scheduler.update ──────────────────────────────────────────────────────────

describe('scheduler.update tool', () => {
  let store: SchedulerStore;
  let toolMap: Record<string, any>;
  beforeEach(() => { ({ store, toolMap } = makeProject()); });
  afterEach(() => { store.close(); });

  it('updates message', async () => {
    const { job } = store.create({ cron: '* * * * *', message: 'old' });
    const result = await exec(toolMap, 'scheduler.update', {
      job_id: job.id,
      message: 'new message',
    });
    expect(result).toContain('updated');
    expect(store.get(job.id)?.message).toBe('new message');
  });

  it('updates cron', async () => {
    const { job } = store.create({ cron: '0 9 * * 1' });
    await exec(toolMap, 'scheduler.update', { job_id: job.id, cron: '0 10 * * 1' });
    expect(store.get(job.id)?.cron).toBe('0 10 * * 1');
  });

  it('returns error for unknown job_id', async () => {
    const result = await exec(toolMap, 'scheduler.update', {
      job_id: 'no-such-id',
      message: 'x',
    });
    expect(result).toContain('not found');
  });

  it('returns error when job_id missing', async () => {
    const result = await exec(toolMap, 'scheduler.update', { message: 'x' });
    expect(result).toContain('Error');
  });

  it('returns error when updating a cancelled job', async () => {
    const { job } = store.create({ cron: '* * * * *' });
    store.cancel(job.id);
    const result = await exec(toolMap, 'scheduler.update', { job_id: job.id, message: 'x' });
    expect(result).toContain('Error');
  });

  it('returns error when both cron and run_at are provided', async () => {
    const { job } = store.create({ cron: '* * * * *' });
    const result = await exec(toolMap, 'scheduler.update', {
      job_id: job.id,
      cron: '0 9 * * 1',
      run_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(result).toContain('Error');
    // job unchanged
    expect(store.get(job.id)?.cron).toBe('* * * * *');
  });

  it('returns error for invalid run_at (non-ISO string)', async () => {
    const { job } = store.create({ cron: '* * * * *' });
    const result = await exec(toolMap, 'scheduler.update', {
      job_id: job.id,
      run_at: 'tomorrow at noon',
    });
    expect(result).toContain('Error');
    expect(result).toContain('invalid run_at');
    // job unchanged
    expect(store.get(job.id)?.cron).toBe('* * * * *');
  });

  it('converts recurring to one-shot when run_at is provided', async () => {
    const { job } = store.create({ cron: '* * * * *' });
    const runAt = new Date(Date.now() + 120_000).toISOString();
    const result = await exec(toolMap, 'scheduler.update', { job_id: job.id, run_at: runAt });
    expect(result).toContain('updated');
    // cron cleared — job is now one-shot
    expect(store.get(job.id)?.cron).toBeUndefined();
  });
});
