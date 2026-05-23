import type { MindStore } from './store.js';
import type { ResolvedMindConfig, MindGoal } from './types.js';
import { estimateTokens } from './utils.js';

// Build and return the --- AGENT MIND --- header string.
// Returns an empty string if all sections are empty (first-run cold start).
// Throws if the store read fails — callers must handle the error.
export async function assemble(store: MindStore, config: ResolvedMindConfig): Promise<string> {
  // All reads are parallel; none require an embedding (spec: assemble() is not embedding-bound)
  const [activeGoals, pinnedReflections, highConfBeliefs, recentReflections] = await Promise.all([
    store.getActiveGoals(),
    store.getPinnedReflections(),
    store.getHighConfidenceBeliefs(20), // fetch more than needed, then trim to budget
    store.getRecentReflections(config.recencyWindowDays, 3),
  ]);

  const goalLines = activeGoals.map(g => formatGoal(g));
  const pinnedLines = pinnedReflections.map(r => `- ${r.content}`);

  // Fill the token budget with high-confidence beliefs, then recent reflections
  const { beliefLines, reflectionLines } = fillBudget(
    highConfBeliefs,
    recentReflections,
    config.tokenBudget,
  );

  // Empty state: no content at all → omit the block entirely
  if (
    goalLines.length === 0 &&
    pinnedLines.length === 0 &&
    beliefLines.length === 0 &&
    reflectionLines.length === 0
  ) {
    return '';
  }

  const sections: string[] = ['--- AGENT MIND ---', ''];

  if (goalLines.length > 0) {
    sections.push('## Goals');
    sections.push(...goalLines);
    sections.push('');
  }

  if (pinnedLines.length > 0) {
    sections.push('## Standing Rules (Pinned)');
    sections.push(...pinnedLines);
    sections.push('');
  }

  if (beliefLines.length > 0) {
    sections.push('## Beliefs');
    sections.push(...beliefLines);
    sections.push('');
  }

  if (reflectionLines.length > 0) {
    sections.push('## Recent Reflections');
    sections.push(...reflectionLines);
    sections.push('');
  }

  sections.push('---');
  return sections.join('\n');
}

function formatGoal(goal: MindGoal): string {
  const lastProgress = goal.progress[goal.progress.length - 1];
  let line = `[${goal.priority}] ${goal.description}`;
  if (lastProgress) {
    line += ` — last progress: ${lastProgress}`;
  }
  if (goal.dueBy) {
    line += ` (due: ${goal.dueBy})`;
  }
  return line;
}

interface ScoredBelief {
  content: string;
  confidence: 'low' | 'medium' | 'high';
  score: number;
}

interface ScoredReflection {
  content: string;
  createdAt: number;
}

function fillBudget(
  beliefs: ScoredBelief[],
  reflections: ScoredReflection[],
  budget: number,
): { beliefLines: string[]; reflectionLines: string[] } {
  let remaining = budget;
  const beliefLines: string[] = [];
  const reflectionLines: string[] = [];

  // Beliefs first (higher priority in the budget)
  for (const b of beliefs) {
    const line = `- ${b.content} (${b.confidence} confidence)`;
    const tokens = estimateTokens(line);
    if (tokens > remaining) break;
    beliefLines.push(line);
    remaining -= tokens;
  }

  // Recent reflections fill whatever is left
  for (const r of reflections) {
    const date = new Date(r.createdAt).toISOString().slice(0, 10);
    const line = `- [${date}] ${r.content}`;
    const tokens = estimateTokens(line);
    if (tokens > remaining) break;
    reflectionLines.push(line);
    remaining -= tokens;
  }

  return { beliefLines, reflectionLines };
}
