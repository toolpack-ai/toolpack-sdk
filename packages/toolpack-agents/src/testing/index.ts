// Testing utilities for toolpack-agents
// Provides mocks, helpers, and utilities for testing agents in isolation

// Mock Channel
export { MockChannel } from './mock-channel.js';

// Mock Knowledge
export { createMockKnowledge, createMockKnowledgeSync, MockKnowledge } from './mock-knowledge.js';
export type { MockKnowledgeOptions } from './mock-knowledge.js';

// Test Agent Factory
export {
  createTestAgent,
  createMockToolpackSimple,
  createMockToolpackSequence,
} from './create-test-agent.js';
export type {
  MockResponse,
  CreateTestAgentOptions,
  TestAgentResult,
} from './create-test-agent.js';

// Eval primitives
export { EvalDataset } from './eval-dataset.js';
export { EvalRunner } from './eval-runner.js';
export type { EvalRunnerOptions } from './eval-runner.js';
export {
  ExactMatchScorer,
  ContainsScorer,
  LLMJudgeScorer,
  CustomScorer,
} from './eval-scorer.js';
export type { EvalScorer, LLMJudgeScorerOptions } from './eval-scorer.js';
export { compareEvalRuns, formatEvalReport } from './eval-report.js';
export type {
  EvalCase,
  EvalCaseResult,
  EvalRun,
  EvalVerdict,
  EvalScoredResult,
  EvalScoredRun,
  EvalRegression,
  EvalImprovement,
  EvalReport,
} from './eval-types.js';

// Event Capture
export { captureEvents, registerEventMatchers } from './capture-events.js';
export type {
  AgentEventName,
  CapturedEvent,
  EventCapture,
} from './capture-events.js';
