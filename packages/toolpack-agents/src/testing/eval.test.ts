import { describe, it, expect, vi } from 'vitest';
import { EvalDataset } from './eval-dataset.js';
import { EvalRunner } from './eval-runner.js';
import {
  ExactMatchScorer,
  ContainsScorer,
  LLMJudgeScorer,
  CustomScorer,
} from './eval-scorer.js';
import { compareEvalRuns, formatEvalReport } from './eval-report.js';
import type { EvalRun, EvalCase } from './eval-types.js';
import type { BaseAgent } from '../agent/base-agent.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const cases: EvalCase[] = [
  { id: 'q1', input: { message: 'What is 2+2?' }, expectedOutput: '4' },
  { id: 'q2', input: { message: 'Capital of France?' }, expectedOutput: 'Paris' },
  { id: 'q3', input: { message: 'Colour of the sky?' }, expectedOutput: 'blue' },
];

function makeRun(outputs: string[], runId = 'test-run'): EvalRun {
  return {
    runId,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    totalDurationMs: 100,
    results: cases.map((c, i) => ({
      evalCase: c,
      actualOutput: outputs[i] ?? '',
      durationMs: 10,
    })),
  };
}

// ─── EvalDataset ──────────────────────────────────────────────────────────────

describe('EvalDataset', () => {
  it('stores cases passed to constructor', () => {
    const dataset = new EvalDataset(cases);
    expect(dataset.size).toBe(3);
    expect(dataset.cases).toHaveLength(3);
  });

  it('get() returns case by id', () => {
    const dataset = new EvalDataset(cases);
    expect(dataset.get('q2')?.expectedOutput).toBe('Paris');
  });

  it('get() returns undefined for unknown id', () => {
    const dataset = new EvalDataset(cases);
    expect(dataset.get('nope')).toBeUndefined();
  });

  it('add() appends cases', () => {
    const dataset = new EvalDataset(cases);
    dataset.add({ id: 'q4', input: { message: 'Hi' }, expectedOutput: 'Hello' });
    expect(dataset.size).toBe(4);
  });

  it('add() throws on duplicate id vs existing', () => {
    const dataset = new EvalDataset(cases);
    expect(() => dataset.add({ id: 'q1', input: { message: 'x' }, expectedOutput: 'x' }))
      .toThrow('already exists');
  });

  it('add() does not partially mutate when duplicate is within the batch', () => {
    const dataset = new EvalDataset([]);
    const newCase = { id: 'n1', input: { message: 'x' }, expectedOutput: 'x' };
    expect(() => dataset.add(newCase, { ...newCase })).toThrow('already exists');
    expect(dataset.size).toBe(0); // no partial add
  });

  it('remove() deletes a case and returns true', () => {
    const dataset = new EvalDataset(cases);
    expect(dataset.remove('q1')).toBe(true);
    expect(dataset.size).toBe(2);
    expect(dataset.get('q1')).toBeUndefined();
  });

  it('remove() returns false for unknown id', () => {
    const dataset = new EvalDataset(cases);
    expect(dataset.remove('nope')).toBe(false);
  });

  it('filter() returns a new dataset matching the predicate', () => {
    const dataset = new EvalDataset(cases);
    const filtered = dataset.filter(c => c.id !== 'q1');
    expect(filtered.size).toBe(2);
    expect(dataset.size).toBe(3); // original unchanged
  });

  it('toJSON() returns a plain array', () => {
    const dataset = new EvalDataset(cases);
    const json = dataset.toJSON();
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(3);
  });

  it('EvalDataset.from() creates from an array', () => {
    const dataset = EvalDataset.from(cases);
    expect(dataset.size).toBe(3);
  });

  it('cases getter returns a defensive copy', () => {
    const dataset = new EvalDataset(cases);
    const first = dataset.cases;
    first.push({ id: 'injected', input: { message: 'x' }, expectedOutput: 'x' });
    expect(dataset.size).toBe(3);
  });
});

// ─── EvalRunner ───────────────────────────────────────────────────────────────

describe('EvalRunner', () => {
  function makeAgent(responses: string[]): BaseAgent {
    let callIdx = 0;
    return {
      invokeAgent: vi.fn(async () => ({
        output: responses[callIdx++] ?? '',
        steps: undefined,
        metadata: undefined,
      })),
    } as unknown as BaseAgent;
  }

  it('runs all cases and returns an EvalRun', async () => {
    const agent = makeAgent(['4', 'Paris', 'blue']);
    const dataset = new EvalDataset(cases);
    const runner = new EvalRunner(agent);
    const run = await runner.run(dataset, { runId: 'v1' });

    expect(run.runId).toBe('v1');
    expect(run.results).toHaveLength(3);
    expect(run.results[0].actualOutput).toBe('4');
    expect(run.results[1].actualOutput).toBe('Paris');
    expect(run.results[2].actualOutput).toBe('blue');
  });

  it('captures errors without throwing', async () => {
    const agent = {
      invokeAgent: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as BaseAgent;
    const dataset = new EvalDataset([cases[0]]);
    const runner = new EvalRunner(agent);
    const run = await runner.run(dataset);

    expect(run.results[0].error).toBe('network error');
    expect(run.results[0].actualOutput).toBe('');
  });

  it('records durationMs per case', async () => {
    const agent = makeAgent(['4']);
    const dataset = new EvalDataset([cases[0]]);
    const runner = new EvalRunner(agent);
    const run = await runner.run(dataset);

    expect(run.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('defaults runId to an ISO timestamp', async () => {
    const agent = makeAgent(['4']);
    const dataset = new EvalDataset([cases[0]]);
    const runner = new EvalRunner(agent);
    const run = await runner.run(dataset);

    expect(run.runId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── ExactMatchScorer ─────────────────────────────────────────────────────────

describe('ExactMatchScorer', () => {
  it('passes when actual equals expected (trimmed)', async () => {
    const scorer = new ExactMatchScorer();
    const run = makeRun(['4', 'Paris', 'blue']);
    const result = await scorer.score(run);

    expect(result.passCount).toBe(3);
    expect(result.failCount).toBe(0);
    expect(result.passRate).toBe(1);
  });

  it('fails when actual differs', async () => {
    const scorer = new ExactMatchScorer();
    const run = makeRun(['5', 'Paris', 'blue']);
    const result = await scorer.score(run);

    expect(result.passCount).toBe(2);
    expect(result.failCount).toBe(1);
    expect(result.scoredResults[0].verdict).toBe('fail');
  });

  it('trims whitespace by default', async () => {
    const scorer = new ExactMatchScorer({ trim: true });
    const run = makeRun(['  4  ', 'Paris', 'blue']);
    const result = await scorer.score(run);
    expect(result.scoredResults[0].verdict).toBe('pass');
  });

  it('is case-sensitive by default', async () => {
    const scorer = new ExactMatchScorer();
    const run = makeRun(['4', 'paris', 'blue']); // lowercase paris
    const result = await scorer.score(run);
    expect(result.scoredResults[1].verdict).toBe('fail');
  });

  it('caseInsensitive option ignores case', async () => {
    const scorer = new ExactMatchScorer({ caseInsensitive: true });
    const run = makeRun(['4', 'PARIS', 'BLUE']);
    const result = await scorer.score(run);
    expect(result.passCount).toBe(3);
  });

  it('fails cases that errored', async () => {
    const scorer = new ExactMatchScorer();
    const run: EvalRun = {
      runId: 'x', startedAt: '', completedAt: '', totalDurationMs: 0,
      results: [{ evalCase: cases[0], actualOutput: '', durationMs: 0, error: 'boom' }],
    };
    const result = await scorer.score(run);
    expect(result.scoredResults[0].verdict).toBe('fail');
    expect(result.scoredResults[0].explanation).toContain('boom');
  });
});

// ─── ContainsScorer ───────────────────────────────────────────────────────────

describe('ContainsScorer', () => {
  it('passes when actual contains expected', async () => {
    const scorer = new ContainsScorer();
    const run = makeRun(['The answer is 4.', 'The capital is Paris!', 'The sky is blue.']);
    const result = await scorer.score(run);
    expect(result.passCount).toBe(3);
  });

  it('fails when actual does not contain expected', async () => {
    const scorer = new ContainsScorer();
    const run = makeRun(['The answer is 5.', 'Paris', 'blue']);
    const result = await scorer.score(run);
    expect(result.scoredResults[0].verdict).toBe('fail');
  });

  it('is case-insensitive by default', async () => {
    const scorer = new ContainsScorer();
    const run = makeRun(['4', 'PARIS IS THE CAPITAL', 'blue']);
    const result = await scorer.score(run);
    expect(result.scoredResults[1].verdict).toBe('pass');
  });

  it('can be made case-sensitive', async () => {
    const scorer = new ContainsScorer({ caseInsensitive: false });
    const run = makeRun(['4', 'paris', 'blue']); // lowercase but expected is 'Paris'
    const result = await scorer.score(run);
    expect(result.scoredResults[1].verdict).toBe('fail');
  });
});

// ─── CustomScorer ─────────────────────────────────────────────────────────────

describe('CustomScorer', () => {
  it('uses the provided function', async () => {
    const scorer = new CustomScorer(async (result) => ({
      verdict: result.actualOutput.length > 0 ? 'pass' : 'fail',
    }));
    const run = makeRun(['4', '', 'blue']);
    const scored = await scorer.score(run);
    expect(scored.scoredResults[0].verdict).toBe('pass');
    expect(scored.scoredResults[1].verdict).toBe('fail');
  });

  it('catches scorer errors and marks as fail', async () => {
    const scorer = new CustomScorer(async () => { throw new Error('scorer crash'); });
    const run = makeRun(['4']);
    const scored = await scorer.score(run);
    expect(scored.scoredResults[0].verdict).toBe('fail');
    expect(scored.scoredResults[0].explanation).toContain('scorer crash');
  });
});

// ─── LLMJudgeScorer ───────────────────────────────────────────────────────────

describe('LLMJudgeScorer', () => {
  function makeJudgeAgent(verdict: 'pass' | 'fail', explanation = ''): BaseAgent {
    return {
      invokeAgent: vi.fn(async () => ({
        output: explanation ? `${verdict}\n${explanation}` : verdict,
      })),
    } as unknown as BaseAgent;
  }

  it('passes when judge returns "pass"', async () => {
    const scorer = new LLMJudgeScorer(makeJudgeAgent('pass'));
    const run = makeRun(['4', 'Paris', 'blue']);
    const scored = await scorer.score(run);
    expect(scored.passCount).toBe(3);
  });

  it('fails when judge returns "fail"', async () => {
    const scorer = new LLMJudgeScorer(makeJudgeAgent('fail'));
    const run = makeRun(['5', 'London', 'red']);
    const scored = await scorer.score(run);
    expect(scored.failCount).toBe(3);
  });

  it('captures explanation from second line', async () => {
    const scorer = new LLMJudgeScorer(makeJudgeAgent('pass', 'The answer is correct.'));
    const scored = await scorer.score(makeRun(['4']));
    expect(scored.scoredResults[0].explanation).toBe('The answer is correct.');
  });

  it('handles judge throwing', async () => {
    const judgeAgent = {
      invokeAgent: vi.fn().mockRejectedValue(new Error('judge exploded')),
    } as unknown as BaseAgent;
    const scorer = new LLMJudgeScorer(judgeAgent);
    const run = makeRun(['4']);
    const scored = await scorer.score(run);
    expect(scored.scoredResults[0].verdict).toBe('fail');
    expect(scored.scoredResults[0].explanation).toContain('judge exploded');
  });
});

// ─── compareEvalRuns ──────────────────────────────────────────────────────────

describe('compareEvalRuns', () => {
  async function scoredRun(outputs: string[], runId: string) {
    const scorer = new ExactMatchScorer();
    return scorer.score(makeRun(outputs, runId));
  }

  it('detects regressions (pass → fail)', async () => {
    const baseline  = await scoredRun(['4', 'Paris', 'blue'], 'v1');
    const candidate = await scoredRun(['5', 'Paris', 'blue'], 'v2');
    const report = compareEvalRuns(baseline, candidate);

    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0].caseId).toBe('q1');
  });

  it('detects improvements (fail → pass)', async () => {
    const baseline  = await scoredRun(['5', 'Paris', 'blue'], 'v1');
    const candidate = await scoredRun(['4', 'Paris', 'blue'], 'v2');
    const report = compareEvalRuns(baseline, candidate);

    expect(report.improvements).toHaveLength(1);
    expect(report.improvements[0].caseId).toBe('q1');
  });

  it('computes stable passes and fails', async () => {
    const baseline  = await scoredRun(['4', 'Paris', 'WRONG'], 'v1');
    const candidate = await scoredRun(['4', 'Paris', 'WRONG'], 'v2');
    const report = compareEvalRuns(baseline, candidate);

    expect(report.stablePasses).toContain('q1');
    expect(report.stablePasses).toContain('q2');
    expect(report.stableFails).toContain('q3');
    expect(report.regressions).toHaveLength(0);
    expect(report.improvements).toHaveLength(0);
  });

  it('computes delta correctly', async () => {
    const baseline  = await scoredRun(['4', 'WRONG', 'WRONG'], 'v1'); // 1/3 pass
    const candidate = await scoredRun(['4', 'Paris', 'WRONG'], 'v2'); // 2/3 pass
    const report = compareEvalRuns(baseline, candidate);

    expect(report.baselinePassRate).toBeCloseTo(1 / 3);
    expect(report.candidatePassRate).toBeCloseTo(2 / 3);
    expect(report.delta).toBeCloseTo(1 / 3);
  });

  it('sets correct run IDs', async () => {
    const baseline  = await scoredRun(['4', 'Paris', 'blue'], 'baseline-v1');
    const candidate = await scoredRun(['4', 'Paris', 'blue'], 'candidate-v2');
    const report = compareEvalRuns(baseline, candidate);

    expect(report.baselineRunId).toBe('baseline-v1');
    expect(report.candidateRunId).toBe('candidate-v2');
  });
});

// ─── formatEvalReport ─────────────────────────────────────────────────────────

describe('formatEvalReport', () => {
  it('includes run IDs and pass rates', async () => {
    const scorer = new ExactMatchScorer();
    const baseline  = await scorer.score(makeRun(['4', 'Paris', 'blue'], 'v1'));
    const candidate = await scorer.score(makeRun(['5', 'Paris', 'blue'], 'v2'));
    const report = compareEvalRuns(baseline, candidate);
    const formatted = formatEvalReport(report);

    expect(formatted).toContain('v1');
    expect(formatted).toContain('v2');
    expect(formatted).toContain('Regressions');
  });

  it('does not include Regressions section when there are none', async () => {
    const scorer = new ExactMatchScorer();
    const baseline  = await scorer.score(makeRun(['4', 'Paris', 'blue'], 'v1'));
    const candidate = await scorer.score(makeRun(['4', 'Paris', 'blue'], 'v2'));
    const report = compareEvalRuns(baseline, candidate);
    const formatted = formatEvalReport(report);

    expect(formatted).not.toContain('Regressions');
  });
});
