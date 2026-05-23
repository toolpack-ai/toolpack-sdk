/**
 * Comprehensive cron-expression compatibility tests.
 *
 * Covers every expression type supported by `cron-parser` (the library used
 * internally by SchedulerStore and ScheduledChannel):
 *
 *   • Standard 5-field  (min  hour  dom  month  dow)
 *   • 6-field with seconds (sec  min  hour  dom  month  dow)
 *   • Wildcards, steps, ranges, lists, combinations
 *   • Named weekdays (MON–SUN) and named months (JAN–DEC)
 *   • Special modifiers: L (last), # (nth weekday)
 *   • Predefined macros: @yearly @monthly @weekly @daily @hourly @minutely
 *   • Invalid expressions that must be rejected
 *
 * Each valid expression is run through BOTH the SchedulerStore (which calls
 * CronExpressionParser internally) and the ScheduledChannel constructor so we
 * confirm both layers accept it.  nextRunAt is asserted to be a valid finite
 * timestamp in the future.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SchedulerStore } from './scheduler-store.js';
import { ScheduledChannel } from '../channels/scheduled-channel.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStore() {
  return new SchedulerStore({ dbPath: ':memory:' });
}

/**
 * Assert that:
 * 1. SchedulerStore.create() does NOT throw
 * 2. nextRunAt is a finite timestamp in the future
 * 3. ScheduledChannel constructor does NOT throw
 */
function assertCronValid(cron: string) {
  // ── Store layer ──────────────────────────────────────────────────────────
  const store = makeStore();
  try {
    const { job } = store.create({ cron });
    expect(job.nextRunAt, `nextRunAt should be finite for: ${cron}`).toBeTypeOf('number');
    expect(isFinite(job.nextRunAt), `nextRunAt should be finite for: ${cron}`).toBe(true);
    expect(job.nextRunAt, `nextRunAt should be in the future for: ${cron}`).toBeGreaterThan(Date.now() - 5_000);
  } finally {
    store.close();
  }

  // ── Channel layer ────────────────────────────────────────────────────────
  expect(() => new ScheduledChannel({ cron }), `ScheduledChannel should accept: ${cron}`).not.toThrow();
}

/**
 * Assert that both the store AND the channel constructor REJECT the expression.
 */
function assertCronInvalid(cron: string) {
  const store = makeStore();
  try {
    expect(() => store.create({ cron }), `store should reject: ${cron}`).toThrow();
  } finally {
    store.close();
  }
  expect(() => new ScheduledChannel({ cron }), `channel should reject: ${cron}`).toThrow();
}

// ── 5-field standard (min hour dom month dow) ─────────────────────────────────

describe('5-field standard expressions', () => {
  const cases: [string, string][] = [
    ['every minute',                    '* * * * *'],
    ['every hour on the hour',          '0 * * * *'],
    ['midnight every day',              '0 0 * * *'],
    ['9am every day',                   '0 9 * * *'],
    ['9am weekdays',                    '0 9 * * 1-5'],
    ['noon on weekends',                '0 12 * * 6,0'],
    ['1st of every month at midnight',  '0 0 1 * *'],
    ['quarterly (1st of Jan/Apr/Jul/Oct)', '0 9 1 1,4,7,10 *'],
    ['annually (1st Jan)',               '0 0 1 1 *'],
    ['twice a day',                     '0 9,17 * * *'],
    ['three times a day',               '0 6,12,18 * * *'],
    ['first and fifteenth',             '0 0 1,15 * *'],
    ['last day of month',               '0 9 L * *'],
    ['last Friday of month',            '0 9 * * 5L'],
    ['first Monday of month',           '0 9 * * 1#1'],
    ['second Wednesday of month',       '0 9 * * 3#2'],
    ['third Thursday of month',         '0 9 * * 4#3'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Step expressions (*/n, range/n) ──────────────────────────────────────────

describe('Step expressions', () => {
  const cases: [string, string][] = [
    ['every 5 minutes',                 '*/5 * * * *'],
    ['every 10 minutes',                '*/10 * * * *'],
    ['every 15 minutes',                '*/15 * * * *'],
    ['every 20 minutes',                '*/20 * * * *'],
    ['every 30 minutes',                '*/30 * * * *'],
    ['every 2 hours',                   '0 */2 * * *'],
    ['every 3 hours',                   '0 */3 * * *'],
    ['every 4 hours',                   '0 */4 * * *'],
    ['every 6 hours',                   '0 */6 * * *'],
    ['every 12 hours',                  '0 */12 * * *'],
    ['every other day',                 '0 0 */2 * *'],
    ['every 5 min in first half-hour',  '0-30/5 * * * *'],
    ['every 10 min in business hours',  '*/10 9-17 * * *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Range expressions ─────────────────────────────────────────────────────────

describe('Range expressions', () => {
  const cases: [string, string][] = [
    ['9am–5pm on the hour',             '0 9-17 * * *'],
    ['midnight–6am on the hour',        '0 0-6 * * *'],
    ['Monday through Friday',           '0 9 * * 1-5'],
    ['Saturday through Sunday',         '0 10 * * 6-7'],
    ['first through fifteenth',         '0 0 1-15 * *'],
    ['January through June',            '0 0 1 1-6 *'],
    ['minutes 0 through 29',            '0-29 * * * *'],
    ['minutes 30 through 59',           '30-59 * * * *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── List expressions ──────────────────────────────────────────────────────────

describe('List expressions', () => {
  const cases: [string, string][] = [
    ['Mon, Wed, Fri',                   '0 9 * * 1,3,5'],
    ['Tue, Thu',                        '0 9 * * 2,4'],
    ['1st, 15th, 28th of month',        '0 0 1,15,28 * *'],
    ['Jan, Jun, Dec',                   '0 0 1 1,6,12 *'],
    ['at :00 :15 :30 :45 each hour',    '0,15,30,45 * * * *'],
    ['6am, noon, 6pm, midnight',        '0 0,6,12,18 * * *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Combined (step + range + list) ────────────────────────────────────────────

describe('Combined expressions', () => {
  const cases: [string, string][] = [
    ['every 15 min during business hours weekdays', '*/15 9-17 * * 1-5'],
    ['every 30 min 8am–6pm',            '*/30 8-18 * * *'],
    ['on the hour 8am–5pm Mon–Fri',     '0 8-17 * * 1-5'],
    ['every 5 min weekday mornings',    '*/5 9-12 * * 1-5'],
    ['noon and midnight Mon/Wed/Fri',   '0 0,12 * * 1,3,5'],
    ['complex business schedule',       '0,30 8-18 * * 1-5'],
    ['bi-hourly on 1st and 15th',       '0 */2 1,15 * *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Named weekdays ────────────────────────────────────────────────────────────

describe('Named weekday expressions (MON–SUN)', () => {
  const cases: [string, string][] = [
    ['Monday',                          '0 9 * * MON'],
    ['Friday',                          '0 9 * * FRI'],
    ['Monday through Friday (named)',   '0 9 * * MON-FRI'],
    ['Saturday and Sunday (named)',     '0 10 * * SAT,SUN'],
    ['Mon, Wed, Fri (named)',           '0 9 * * MON,WED,FRI'],
    ['Tue, Thu (named)',                '0 9 * * TUE,THU'],
    ['Weekdays lowercase',              '0 9 * * mon-fri'],
    ['Weekend mixed case',              '0 10 * * Sat,Sun'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Named months ──────────────────────────────────────────────────────────────

describe('Named month expressions (JAN–DEC)', () => {
  const cases: [string, string][] = [
    ['January',                         '0 0 1 JAN *'],
    ['December',                        '0 0 1 DEC *'],
    ['Jan, Jun, Dec (named)',           '0 0 1 JAN,JUN,DEC *'],
    ['Mar through Aug (named)',         '0 0 1 MAR-AUG *'],
    ['Q1 months (named)',               '0 0 1 JAN,FEB,MAR *'],
    ['Summer months (named)',           '0 0 1 JUN,JUL,AUG *'],
    ['Named month lowercase',           '0 0 1 jan *'],
    ['Named month mixed case',          '0 0 1 Jan,Jun,Dec *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── 6-field expressions (sec min hour dom month dow) ─────────────────────────

describe('6-field expressions (with leading seconds field)', () => {
  const cases: [string, string][] = [
    ['every second',                    '* * * * * *'],
    ['every 30 seconds',                '*/30 * * * * *'],
    ['every minute at :00',             '0 * * * * *'],
    ['every 5 minutes at :00',          '0 */5 * * * *'],
    ['every 15 minutes at :00',         '0 */15 * * * *'],
    ['every 30 minutes at :30s',        '30 */30 * * * *'],
    ['every hour at :00:00',            '0 0 * * * *'],
    ['9am weekdays at :00:00',          '0 0 9 * * 1-5'],
    ['every 10 seconds',                '*/10 * * * * *'],
    ['every 5 seconds',                 '*/5 * * * * *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Predefined macros ─────────────────────────────────────────────────────────

describe('Predefined macro expressions (@alias)', () => {
  const cases: [string, string][] = [
    ['@yearly  (once a year)',           '@yearly'],
    ['@annually (alias for @yearly)',    '@annually'],
    ['@monthly (once a month)',          '@monthly'],
    ['@weekly  (once a week)',           '@weekly'],
    ['@daily   (once a day)',            '@daily'],
    ['@hourly  (once an hour)',          '@hourly'],
    ['@minutely (once a minute)',        '@minutely'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Edge / boundary expressions ───────────────────────────────────────────────

describe('Edge and boundary expressions', () => {
  const cases: [string, string][] = [
    ['minute 0 only',                   '0 * * * *'],
    ['minute 59 only',                  '59 * * * *'],
    ['hour 0 only',                     '* 0 * * *'],
    ['hour 23 only',                    '* 23 * * *'],
    ['dom 1 (first)',                    '0 0 1 * *'],
    ['dom 28 (safe last)',               '0 0 28 * *'],
    ['month 1 (Jan)',                    '0 0 * 1 *'],
    ['month 12 (Dec)',                   '0 0 * 12 *'],
    ['dow 0 (Sunday)',                   '0 0 * * 0'],
    ['dow 7 (Sunday alt)',               '0 0 * * 7'],
    ['dow 6 (Saturday)',                 '0 0 * * 6'],
    ['every min every day of Feb',      '* * * 2 *'],
    ['leapyear-safe: Feb 28',            '0 0 28 2 *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronValid(cron));
  }
});

// ── Library quirks — documented accepted edge cases ───────────────────────────

describe('Library quirks (cron-parser specific behaviour)', () => {
  it('accepts a 4-field expression — cron-parser pads missing dow with *', () => {
    // cron-parser treats "* * * *" as "* * * * *" (dow defaults to *)
    // This is a library quirk, not an error. Document and accept it.
    assertCronValid('* * * *');
  });
});

// ── Invalid expressions (must be rejected) ────────────────────────────────────

describe('Invalid expressions — must throw', () => {
  const cases: [string, string][] = [
    ['empty string',                    ''],
    // Note: cron-parser accepts 4-field — the following must have ≥5 fields to be clearly invalid
    ['too many fields (7-field)',       '* * * * * * *'],
    ['random text',                     'every day at 9am'],
    ['out-of-range minute (60)',        '60 * * * *'],
    ['out-of-range hour (24)',          '* 24 * * *'],
    ['out-of-range dom (32)',           '* * 32 * *'],
    ['out-of-range month (13)',         '* * * 13 *'],
    ['out-of-range dow (8)',            '* * * * 8'],
    ['step of zero',                   '*/0 * * * *'],
    ['invalid named day',              '0 9 * * FUNDAY'],
    ['invalid named month',            '0 0 1 OCTEMBER *'],
    ['unsupported W modifier',         '0 9 15W * *'],
    ['unsupported LW modifier',        '0 9 LW * *'],
    ['@midnight (not supported by cron-parser)', '@midnight'],
    ['hour range out of bounds (0-29)', '*/5 0-29 * * *'],
  ];

  for (const [label, cron] of cases) {
    it(label, () => assertCronInvalid(cron));
  }
});
