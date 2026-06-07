import type { BaseAgent } from '../agent/base-agent.js';
import type {
  EvalRun,
  EvalCaseResult,
  EvalScoredResult,
  EvalScoredRun,
  EvalVerdict,
} from './eval-types.js';

// ─── Scorer interface ─────────────────────────────────────────────────────────

/**
 * A scorer evaluates each `EvalCaseResult` in a run and produces a
 * pass/fail verdict with an optional explanation.
 *
 * Implement this interface to create custom scoring logic.
 */
export interface EvalScorer {
  score(run: EvalRun): Promise<EvalScoredRun>;
}

// ─── Shared helper ────────────────────────────────────────────────────────────

function buildScoredRun(run: EvalRun, scoredResults: EvalScoredResult[]): EvalScoredRun {
  const passCount = scoredResults.filter(r => r.verdict === 'pass').length;
  const failCount = scoredResults.length - passCount;
  return {
    run,
    scoredResults,
    passCount,
    failCount,
    passRate: scoredResults.length === 0 ? 0 : passCount / scoredResults.length,
  };
}

function scoreResult(result: EvalCaseResult, verdict: EvalVerdict, explanation?: string): EvalScoredResult {
  const scored: EvalScoredResult = { caseResult: result, verdict };
  if (explanation !== undefined) scored.explanation = explanation;
  return scored;
}

// ─── ExactMatchScorer ─────────────────────────────────────────────────────────

/**
 * Passes a case when `actualOutput` exactly equals `expectedOutput`.
 * Optionally case-insensitive and/or trimmed.
 *
 * @example
 * ```ts
 * const scorer = new ExactMatchScorer({ trim: true, caseInsensitive: true });
 * const scored = await scorer.score(run);
 * ```
 */
export class ExactMatchScorer implements EvalScorer {
  private trim: boolean;
  private caseInsensitive: boolean;

  constructor(options: { trim?: boolean; caseInsensitive?: boolean } = {}) {
    this.trim = options.trim ?? true;
    this.caseInsensitive = options.caseInsensitive ?? false;
  }

  async score(run: EvalRun): Promise<EvalScoredRun> {
    const scoredResults = run.results.map(result => {
      if (result.error) {
        return scoreResult(result, 'fail', `Agent threw: ${result.error}`);
      }

      let actual = result.actualOutput;
      let expected = result.evalCase.expectedOutput;

      if (this.trim) {
        actual = actual.trim();
        expected = expected.trim();
      }
      if (this.caseInsensitive) {
        actual = actual.toLowerCase();
        expected = expected.toLowerCase();
      }

      const pass = actual === expected;
      return scoreResult(result, pass ? 'pass' : 'fail');
    });

    return buildScoredRun(run, scoredResults);
  }
}

// ─── ContainsScorer ───────────────────────────────────────────────────────────

/**
 * Passes a case when `actualOutput` contains `expectedOutput` as a substring.
 * Optionally case-insensitive.
 *
 * @example
 * ```ts
 * const scorer = new ContainsScorer({ caseInsensitive: true });
 * const scored = await scorer.score(run);
 * ```
 */
export class ContainsScorer implements EvalScorer {
  private caseInsensitive: boolean;

  constructor(options: { caseInsensitive?: boolean } = {}) {
    this.caseInsensitive = options.caseInsensitive ?? true;
  }

  async score(run: EvalRun): Promise<EvalScoredRun> {
    const scoredResults = run.results.map(result => {
      if (result.error) {
        return scoreResult(result, 'fail', `Agent threw: ${result.error}`);
      }

      let actual = result.actualOutput;
      let expected = result.evalCase.expectedOutput;

      if (this.caseInsensitive) {
        actual = actual.toLowerCase();
        expected = expected.toLowerCase();
      }

      const pass = actual.includes(expected);
      return scoreResult(result, pass ? 'pass' : 'fail');
    });

    return buildScoredRun(run, scoredResults);
  }
}

// ─── LLMJudgeScorer ───────────────────────────────────────────────────────────

export interface LLMJudgeScorerOptions {
  /**
   * Custom judge prompt template.
   * Use `{{question}}`, `{{expected}}`, and `{{actual}}` as placeholders.
   * Must instruct the LLM to respond with only "pass" or "fail" on the first line,
   * optionally followed by an explanation.
   */
  promptTemplate?: string;
}

const DEFAULT_JUDGE_PROMPT = `You are an impartial evaluator assessing whether an AI agent's answer is correct.

Question / Task:
{{question}}

Expected answer:
{{expected}}

Actual answer:
{{actual}}

Is the actual answer correct or equivalent to the expected answer?
Respond with ONLY "pass" or "fail" on the first line, then optionally a one-sentence explanation.`;

/**
 * Uses an LLM agent as a judge to score each case.
 * The judge is prompted with the question, expected answer, and actual answer.
 *
 * @example
 * ```ts
 * const judgeAgent = new MyAgent({ toolpack });
 * const scorer = new LLMJudgeScorer(judgeAgent);
 * const scored = await scorer.score(run);
 * ```
 */
export class LLMJudgeScorer implements EvalScorer {
  private judgeAgent: BaseAgent;
  private promptTemplate: string;

  constructor(judgeAgent: BaseAgent, options: LLMJudgeScorerOptions = {}) {
    this.judgeAgent = judgeAgent;
    this.promptTemplate = options.promptTemplate ?? DEFAULT_JUDGE_PROMPT;
  }

  async score(run: EvalRun): Promise<EvalScoredRun> {
    const scoredResults: EvalScoredResult[] = [];

    for (const result of run.results) {
      if (result.error) {
        scoredResults.push(scoreResult(result, 'fail', `Agent threw: ${result.error}`));
        continue;
      }

      const prompt = this.promptTemplate
        .replace('{{question}}', result.evalCase.input.message)
        .replace('{{expected}}', result.evalCase.expectedOutput)
        .replace('{{actual}}', result.actualOutput);

      try {
        const judgeResult = await this.judgeAgent.invokeAgent({ message: prompt });
        const lines = judgeResult.output.trim().split('\n');
        const verdict: EvalVerdict = lines[0].toLowerCase().startsWith('pass') ? 'pass' : 'fail';
        const explanation = lines.slice(1).join(' ').trim() || undefined;
        scoredResults.push(scoreResult(result, verdict, explanation));
      } catch (err) {
        scoredResults.push(
          scoreResult(result, 'fail', `Judge threw: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }

    return buildScoredRun(run, scoredResults);
  }
}

// ─── CustomScorer ─────────────────────────────────────────────────────────────

/**
 * Wraps a user-supplied scoring function.
 *
 * @example
 * ```ts
 * const scorer = new CustomScorer(async (result) => {
 *   const pass = result.actualOutput.includes('Paris');
 *   return { verdict: pass ? 'pass' : 'fail' };
 * });
 * ```
 */
export class CustomScorer implements EvalScorer {
  private fn: (result: EvalCaseResult) => Promise<{ verdict: EvalVerdict; explanation?: string }>;

  constructor(fn: (result: EvalCaseResult) => Promise<{ verdict: EvalVerdict; explanation?: string }>) {
    this.fn = fn;
  }

  async score(run: EvalRun): Promise<EvalScoredRun> {
    const scoredResults: EvalScoredResult[] = [];

    for (const result of run.results) {
      if (result.error) {
        scoredResults.push(scoreResult(result, 'fail', `Agent threw: ${result.error}`));
        continue;
      }

      try {
        const { verdict, explanation } = await this.fn(result);
        scoredResults.push(scoreResult(result, verdict, explanation));
      } catch (err) {
        scoredResults.push(
          scoreResult(result, 'fail', `Scorer threw: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }

    return buildScoredRun(run, scoredResults);
  }
}
