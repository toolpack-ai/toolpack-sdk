import type { EvalScoredRun, EvalReport, EvalRegression, EvalImprovement } from './eval-types.js';

/**
 * Compares two scored runs and produces a regression/improvement report.
 *
 * @example
 * ```ts
 * const report = compareEvalRuns(baselineScoredRun, candidateScoredRun);
 *
 * if (report.regressions.length > 0) {
 *   console.error('Regressions detected:', report.regressions);
 *   process.exit(1);
 * }
 *
 * console.log(`Pass rate: ${report.baselinePassRate} → ${report.candidatePassRate} (Δ${report.delta > 0 ? '+' : ''}${report.delta.toFixed(2)})`);
 * ```
 */
export function compareEvalRuns(baseline: EvalScoredRun, candidate: EvalScoredRun): EvalReport {
  const baselineById = new Map(baseline.scoredResults.map(r => [r.caseResult.evalCase.id, r]));
  const candidateById = new Map(candidate.scoredResults.map(r => [r.caseResult.evalCase.id, r]));

  const regressions: EvalRegression[] = [];
  const improvements: EvalImprovement[] = [];
  const stablePasses: string[] = [];
  const stableFails: string[] = [];

  // Union of all case IDs across both runs
  const allIds = new Set([...baselineById.keys(), ...candidateById.keys()]);

  for (const id of allIds) {
    const base = baselineById.get(id);
    const cand = candidateById.get(id);

    // Case only in one run — skip regression/improvement analysis
    if (!base || !cand) continue;

    if (base.verdict === 'pass' && cand.verdict === 'fail') {
      regressions.push({
        caseId: id,
        baselineOutput: base.caseResult.actualOutput,
        candidateOutput: cand.caseResult.actualOutput,
      });
    } else if (base.verdict === 'fail' && cand.verdict === 'pass') {
      improvements.push({
        caseId: id,
        baselineOutput: base.caseResult.actualOutput,
        candidateOutput: cand.caseResult.actualOutput,
      });
    } else if (base.verdict === 'pass' && cand.verdict === 'pass') {
      stablePasses.push(id);
    } else {
      stableFails.push(id);
    }
  }

  const delta = candidate.passRate - baseline.passRate;

  return {
    baselineRunId: baseline.run.runId,
    candidateRunId: candidate.run.runId,
    baselinePassRate: baseline.passRate,
    candidatePassRate: candidate.passRate,
    delta,
    regressions,
    improvements,
    stablePasses,
    stableFails,
  };
}

/**
 * Format an `EvalReport` as a human-readable summary string.
 *
 * @example
 * ```ts
 * console.log(formatEvalReport(report));
 * ```
 */
export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];
  const deltaSign = report.delta >= 0 ? '+' : '';
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  lines.push(`Eval Report: ${report.baselineRunId} → ${report.candidateRunId}`);
  lines.push(`Pass rate:   ${pct(report.baselinePassRate)} → ${pct(report.candidatePassRate)} (Δ${deltaSign}${pct(report.delta)})`);
  lines.push('');

  if (report.regressions.length > 0) {
    lines.push(`Regressions (${report.regressions.length}):`);
    for (const r of report.regressions) {
      lines.push(`  ✗ ${r.caseId}`);
      lines.push(`    baseline:  ${truncate(r.baselineOutput)}`);
      lines.push(`    candidate: ${truncate(r.candidateOutput)}`);
    }
    lines.push('');
  }

  if (report.improvements.length > 0) {
    lines.push(`Improvements (${report.improvements.length}):`);
    for (const imp of report.improvements) {
      lines.push(`  ✓ ${imp.caseId}`);
      lines.push(`    baseline:  ${truncate(imp.baselineOutput)}`);
      lines.push(`    candidate: ${truncate(imp.candidateOutput)}`);
    }
    lines.push('');
  }

  lines.push(`Stable passes: ${report.stablePasses.length}  |  Stable fails: ${report.stableFails.length}`);

  return lines.join('\n');
}

function truncate(s: string, max = 80): string {
  const single = s.replace(/\n/g, ' ');
  return single.length > max ? `${single.slice(0, max)}…` : single;
}
