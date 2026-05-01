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

// Event Capture
export { captureEvents, registerEventMatchers } from './capture-events.js';
export type {
  AgentEventName,
  CapturedEvent,
  EventCapture,
} from './capture-events.js';
