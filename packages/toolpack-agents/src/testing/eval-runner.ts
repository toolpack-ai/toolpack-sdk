import type { BaseAgent } from '../agent/base-agent.js';
import type { EvalDataset } from './eval-dataset.js';
import type { EvalRun, EvalCaseResult } from './eval-types.js';

export interface EvalRunnerOptions {
  /**
   * Identifier for this run — use something meaningful like a version or PR number.
   * Defaults to a timestamp string.
   */
  runId?: string;

  /**
   * Concurrency limit — how many cases to run in parallel.
   * Defaults to 1 (sequential) to avoid overwhelming the provider.
   */
  concurrency?: number;
}

/**
 * Runs an agent against every case in an `EvalDataset` and collects the
 * results into an `EvalRun`.
 *
 * @example
 * ```ts
 * const runner = new EvalRunner(agent);
 * const run = await runner.run(dataset, { runId: 'v1.2' });
 *
 * console.log(`${run.results.length} cases run in ${run.totalDurationMs}ms`);
 * ```
 */
export class EvalRunner {
  private agent: BaseAgent;

  constructor(agent: BaseAgent) {
    this.agent = agent;
  }

  /**
   * Run all cases in the dataset and return an `EvalRun`.
   */
  async run(dataset: EvalDataset, options: EvalRunnerOptions = {}): Promise<EvalRun> {
    const runId = options.runId ?? new Date().toISOString();
    const concurrency = Math.max(1, options.concurrency ?? 1);
    const startedAt = new Date().toISOString();
    const runStart = Date.now();

    const cases = dataset.cases;
    const results: EvalCaseResult[] = [];

    // Process in batches of `concurrency`
    for (let i = 0; i < cases.length; i += concurrency) {
      const batch = cases.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (evalCase) => {
          const caseStart = Date.now();
          try {
            const result = await this.agent.invokeAgent({
              message: evalCase.input.message,
              intent: evalCase.input.intent,
              conversationId: evalCase.input.conversationId,
              context: evalCase.input.context,
            });
            return {
              evalCase,
              actualOutput: result.output,
              durationMs: Date.now() - caseStart,
            } satisfies EvalCaseResult;
          } catch (err) {
            return {
              evalCase,
              actualOutput: '',
              durationMs: Date.now() - caseStart,
              error: err instanceof Error ? err.message : String(err),
            } satisfies EvalCaseResult;
          }
        }),
      );
      results.push(...batchResults);
    }

    return {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - runStart,
      results,
    };
  }
}
