/**
 * Eval primitives — shared types across EvalDataset, EvalRunner, EvalScorer, and EvalReport.
 */

// ─── Dataset ──────────────────────────────────────────────────────────────────

/**
 * A single eval case: an input fed to the agent and the expected output used
 * for scoring.
 */
export interface EvalCase {
  /** Unique identifier for this case. */
  id: string;

  /** The input passed to `agent.invokeAgent()`. */
  input: {
    message: string;
    intent?: string;
    conversationId?: string;
    context?: Record<string, unknown>;
  };

  /**
   * The expected output used by scorers.
   * Exact-match and contains scorers compare `actualOutput` against this.
   * LLM-judge scorers use it as the reference answer.
   */
  expectedOutput: string;

  /** Optional free-form metadata (e.g. tags, difficulty, source). */
  metadata?: Record<string, unknown>;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * The actual output produced by running a single eval case against an agent.
 */
export interface EvalCaseResult {
  /** The eval case that was run. */
  evalCase: EvalCase;

  /** The output produced by the agent. */
  actualOutput: string;

  /** Wall-clock duration in milliseconds. */
  durationMs: number;

  /** Error message if the agent threw, otherwise undefined. */
  error?: string;
}

/**
 * The result of running an entire dataset through an agent.
 */
export interface EvalRun {
  /** Identifier for this run (e.g. "v1.2", "pr-456"). */
  runId: string;

  /** ISO timestamp of when the run started. */
  startedAt: string;

  /** ISO timestamp of when the run completed. */
  completedAt: string;

  /** Total wall-clock duration in milliseconds. */
  totalDurationMs: number;

  /** Per-case results, in dataset order. */
  results: EvalCaseResult[];
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

/** The verdict for a single scored case. */
export type EvalVerdict = 'pass' | 'fail';

/**
 * A scored result — wraps an EvalCaseResult with a pass/fail verdict and
 * an optional explanation.
 */
export interface EvalScoredResult {
  /** The underlying case result. */
  caseResult: EvalCaseResult;

  /** Pass or fail. */
  verdict: EvalVerdict;

  /**
   * Optional human-readable explanation of the verdict.
   * Populated by LLMJudgeScorer; optional for other scorers.
   */
  explanation?: string;
}

/**
 * A fully scored run — an EvalRun annotated with per-case verdicts and
 * aggregate pass/fail counts.
 */
export interface EvalScoredRun {
  /** The original run. */
  run: EvalRun;

  /** Scored results, in run order. */
  scoredResults: EvalScoredResult[];

  /** Number of passing cases. */
  passCount: number;

  /** Number of failing cases. */
  failCount: number;

  /** Pass rate as a fraction between 0 and 1. */
  passRate: number;
}

// ─── Report ───────────────────────────────────────────────────────────────────

/**
 * A regression entry — a case that passed in the baseline but fails in the
 * candidate.
 */
export interface EvalRegression {
  caseId: string;
  baselineOutput: string;
  candidateOutput: string;
}

/**
 * An improvement entry — a case that failed in the baseline but passes in the
 * candidate.
 */
export interface EvalImprovement {
  caseId: string;
  baselineOutput: string;
  candidateOutput: string;
}

/**
 * Comparison report between a baseline scored run and a candidate scored run.
 */
export interface EvalReport {
  baselineRunId: string;
  candidateRunId: string;

  baselinePassRate: number;
  candidatePassRate: number;

  /** Δ pass rate (candidate − baseline). Positive = improvement. */
  delta: number;

  regressions: EvalRegression[];
  improvements: EvalImprovement[];

  /** Cases that passed in both runs. */
  stablePasses: string[];

  /** Cases that failed in both runs. */
  stableFails: string[];
}
