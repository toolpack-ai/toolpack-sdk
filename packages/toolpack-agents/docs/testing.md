# Testing Agents

`@toolpack-sdk/agents` ships testing utilities that let you unit-test agents in complete isolation — no API keys, no live channels, no network calls.

## Import path

```typescript
import { createTestAgent, MockChannel, captureEvents, createMockKnowledge } from '@toolpack-sdk/agents/testing';
```

The testing utilities live in the `./testing` sub-path export, not in the main package root.

## Contents

- [createTestAgent()](#createtestagent)
- [MockChannel](#mockchannel)
- [MockResponse matching](#mockresponse-matching)
- [captureEvents()](#captureevents)
- [createMockKnowledge()](#createmockknowledge)
- [Testing patterns](#testing-patterns)

---

## createTestAgent()

The primary testing factory. Creates an agent instance wired to a `MockChannel` and a mock Toolpack that returns scripted responses.

```typescript
import { createTestAgent } from '@toolpack-sdk/agents/testing';

function createTestAgent<TAgent extends BaseAgent>(
  AgentClass: new (options: BaseAgentOptions) => TAgent,
  options?: CreateTestAgentOptions,
): TestAgentResult<TAgent>
```

### Options

```typescript
interface CreateTestAgentOptions {
  mockResponses?: MockResponse[];      // scripted LLM responses
  defaultResponse?: string;            // fallback when no trigger matches (default: 'Mock AI response')
  provider?: string;                   // mock provider name
  model?: string;                      // mock model name
}

interface MockResponse {
  trigger: string | RegExp;            // matched against user message
  response: string;                    // what the mock LLM returns
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

### Return value

```typescript
interface TestAgentResult<TAgent extends BaseAgent> {
  agent: TAgent;                                           // the agent instance
  channel: MockChannel;                                    // mock channel wired to the agent
  toolpack: Toolpack;                                      // mock toolpack instance
  addMockResponse: (response: MockResponse) => void;       // add responses after creation
}
```

### Example

```typescript
import { describe, it, expect } from 'vitest';
import { createTestAgent } from '@toolpack-sdk/agents/testing';
import { SupportAgent } from './support-agent.js';

describe('SupportAgent', () => {
  it('handles a refund request', async () => {
    const { agent, channel } = createTestAgent(SupportAgent, {
      mockResponses: [
        { trigger: 'refund', response: 'Your refund has been approved.' },
      ],
    });

    const result = await agent.invokeAgent({
      message: 'I need a refund for order #12345',
      conversationId: 'test-conv-1',
      participant: { kind: 'user', id: 'user-1', displayName: 'Alice' },
    });

    expect(result.output).toBe('Your refund has been approved.');
  });

  it('returns default response for unmatched messages', async () => {
    const { agent } = createTestAgent(SupportAgent, {
      defaultResponse: 'How can I help you today?',
    });

    const result = await agent.invokeAgent({
      message: 'Hello',
      conversationId: 'test-conv-2',
    });

    expect(result.output).toBe('How can I help you today?');
  });
});
```

---

## MockChannel

`MockChannel` implements `ChannelInterface` and records all inputs and outputs. Wired automatically by `createTestAgent`, but can also be used standalone.

```typescript
import { MockChannel } from '@toolpack-sdk/agents/testing';

const channel = new MockChannel();
```

### Properties

```typescript
class MockChannel implements ChannelInterface {
  name = 'mock-channel';
  isTriggerChannel = false;

  // Inspection
  get inputs(): AgentInput[];              // normalized messages received (inbound)
  get outputs(): AgentOutput[];            // messages sent (outbound)
  get lastInput(): AgentInput | undefined;
  get lastOutput(): AgentOutput | undefined;
  get receivedCount(): number;
  get sentCount(): number;
  get isListening(): boolean;

  // Simulation
  async receive(incoming: unknown): Promise<void>;       // normalize + invoke handler
  async receiveMessage(
    message: string,
    conversationId?: string,
    intent?: string,
    context?: Record<string, unknown>,
  ): Promise<void>;
  async send(output: AgentOutput): Promise<void>;        // record outbound message
  clear(): void;                                          // reset captured inputs/outputs

  // Assertion helpers
  assertOutputContains(text: string): void;
  assertLastOutput(expected: string): void;

  // ChannelInterface compliance
  listen(): void;
  stop(): void;
  normalize(incoming: unknown): AgentInput;
  onMessage(handler: (input: AgentInput) => Promise<void>): void;
}
```

### Simulating messages

`receive()` accepts `unknown` and runs it through `normalize()` — it does **not** take an `AgentInput` directly. Use `receiveMessage()` for the most common case:

```typescript
// Simple text message
await channel.receiveMessage(
  'What is my account balance?',
  'conv-abc',              // conversationId (default: 'test-conversation-1')
  'balance_inquiry',       // intent (optional)
  { userId: 'user-42' },  // context (optional)
);

expect(channel.lastOutput?.output).toContain('balance');
expect(channel.sentCount).toBe(1);
```

Or use `receive()` with a raw object (normalized via `normalize()`):

```typescript
await channel.receive({
  message: 'Check order #789',
  conversationId: 'conv-1',
  intent: 'order_lookup',
});
```

### Full channel-driven test

```typescript
it('processes message through full interceptor chain', async () => {
  const { agent, channel } = createTestAgent(MyAgent, {
    mockResponses: [{ trigger: /order/i, response: 'Order found.' }],
  });

  await agent.start();   // binds channel handlers + interceptor chain

  await channel.receive({ message: 'Check order #789', conversationId: 'conv-1' });

  expect(channel.outputs).toHaveLength(1);
  expect(channel.lastOutput?.output).toBe('Order found.');

  await agent.stop();
});
```

### Built-in assertions

```typescript
channel.assertOutputContains('approved');   // throws if no output contains this text
channel.assertLastOutput('Exact match');    // throws if last output !== expected
```

---

## MockResponse matching

The mock toolpack checks responses in order. First match wins.

- **String trigger**: checks if the user message **contains** the trigger string (case-sensitive).
- **RegExp trigger**: tests the user message against the regex.
- **`defaultResponse`**: returned when no trigger matches.

```typescript
const { agent } = createTestAgent(MyAgent, {
  mockResponses: [
    { trigger: /cancel.*order/i, response: 'Order cancellation initiated.' },
    { trigger: 'cancel', response: 'What would you like to cancel?' },
    { trigger: /refund/i, response: 'Refund request received.' },
  ],
  defaultResponse: 'I can help with that.',
});
```

Add responses dynamically:

```typescript
const { agent, addMockResponse } = createTestAgent(MyAgent);
addMockResponse({ trigger: 'shipping', response: 'Your package ships in 2 days.' });
```

---

## captureEvents()

Captures agent lifecycle events emitted during a test run. Returns a rich `EventCapture` object with assertion helpers.

```typescript
import { captureEvents } from '@toolpack-sdk/agents/testing';

const events = captureEvents(agent);   // no options argument

// ... run agent ...

events.stop();   // detach listeners
```

### EventCapture API

```typescript
type AgentEventName = 'agent:start' | 'agent:complete' | 'agent:error';
// Note: 'agent:step' is NOT an event name — only the three above are captured.

interface CapturedEvent {
  name: AgentEventName;
  data: unknown;           // event payload
  timestamp: number;       // Date.now() value (number, not Date)
}

interface EventCapture {
  readonly events: CapturedEvent[];
  readonly count: number;

  clear(): void;
  stop(): void;                                               // remove listeners

  hasEvent(name: AgentEventName): boolean;
  getEvents(name: AgentEventName): CapturedEvent[];
  getFirstEvent(name: AgentEventName): CapturedEvent | undefined;
  getLastEvent(name: AgentEventName): CapturedEvent | undefined;
  assertEvent(name: AgentEventName): void;                    // throws if event not found
  assertNoEvent(name: AgentEventName): void;                  // throws if event was found
}
```

### Example

```typescript
it('emits start and complete events', async () => {
  const { agent } = createTestAgent(MyAgent, { defaultResponse: 'Done.' });
  const events = captureEvents(agent);

  await agent.invokeAgent({ message: 'Hello', conversationId: 'c1' });

  events.assertEvent('agent:start');
  events.assertEvent('agent:complete');
  events.assertNoEvent('agent:error');

  events.stop();
});
```

### Custom Vitest/Jest matchers

```typescript
import { registerEventMatchers } from '@toolpack-sdk/agents/testing';
import { expect } from 'vitest';

// In your test setup file:
registerEventMatchers(expect);

// Then in tests:
expect(events).toContainEvent('agent:start');
expect(events).not.toContainEvent('agent:error');
expect(events).toContainEventTimes('agent:complete', 1);
```

---

## createMockKnowledge()

Provides an in-memory `Knowledge` instance pre-populated with test data. Useful for testing agents that query a knowledge base without needing a real embedder or vector store.

```typescript
import { createMockKnowledge, createMockKnowledgeSync } from '@toolpack-sdk/agents/testing';
```

### createMockKnowledge (async)

Returns a real `Knowledge` instance from `@toolpack-sdk/knowledge` backed by a `MemoryProvider` and a deterministic mock embedder.

```typescript
interface MockKnowledgeOptions {
  initialChunks?: Array<{
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  dimensions?: number;     // embedding dimensions (default: 384)
  description?: string;    // tool description exposed to LLM
}

const knowledge = await createMockKnowledge({
  initialChunks: [
    { content: 'Lead: Acme Corp, score: 85', metadata: { source: 'crm' } },
    { content: 'Lead: TechStart, score: 70', metadata: { source: 'crm' } },
  ],
});
```

### createMockKnowledgeSync (sync)

Returns a `MockKnowledge` class instance — not a full `Knowledge` object, but suitable for testing agents that use knowledge queries. Supports `query()`, `add()`, `getAllChunks()`, `clear()`, and `toTool()`.

```typescript
const knowledge = createMockKnowledgeSync({
  initialChunks: [
    { content: 'Refund policy: 30-day no-questions-asked return' },
  ],
});

// Use knowledge.toTool() to wire it as a tool into a mock Toolpack
const tool = knowledge.toTool();   // returns a RequestToolDefinition
```

Uses simple keyword matching (not semantic similarity) for queries, which is sufficient for most test assertions.

---

## Testing patterns

### Testing intent routing

```typescript
it('routes billing intent correctly', async () => {
  const { agent } = createTestAgent(SupportAgent, {
    mockResponses: [
      { trigger: 'billing', response: 'Here is your billing summary.' },
    ],
  });

  const result = await agent.invokeAgent({
    intent: 'billing',
    message: 'Show me my bills',
    conversationId: 'c1',
  });

  expect(result.output).toBe('Here is your billing summary.');
});
```

### Testing delegation

```typescript
import { AgentRegistry } from '@toolpack-sdk/agents';
import { createTestAgent } from '@toolpack-sdk/agents/testing';

it('delegates to data agent', async () => {
  const { agent: mainAgent } = createTestAgent(OrchestratorAgent);
  const { agent: dataAgent } = createTestAgent(DataAgent, {
    defaultResponse: 'Data analysis complete.',
  });

  const registry = new AgentRegistry([mainAgent, dataAgent]);
  await registry.start();

  const result = await registry.invoke('orchestrator-agent', {
    message: 'Analyse sales',
    conversationId: 'c1',
  });

  expect(result.output).toContain('complete');
});
```

### Testing conversation history

```typescript
it('remembers previous messages', async () => {
  const { agent } = createTestAgent(MyAgent, {
    mockResponses: [
      { trigger: 'name is Bob', response: 'Nice to meet you, Bob.' },
      { trigger: 'remember', response: 'You told me your name is Bob.' },
    ],
  });

  await agent.invokeAgent({ message: 'My name is Bob', conversationId: 'conv-1' });

  const result = await agent.invokeAgent({
    message: 'Do you remember my name?',
    conversationId: 'conv-1',   // same conversation
  });

  expect(result.output).toContain('Bob');
});
```

### Testing lifecycle hooks

```typescript
it('calls onComplete after successful run', async () => {
  const { agent } = createTestAgent(MyAgent, { defaultResponse: 'Done.' });

  let completedWith: AgentResult | null = null;
  agent.onComplete = async (result) => { completedWith = result; };

  await agent.invokeAgent({ message: 'test', conversationId: 'c1' });

  expect(completedWith?.output).toBe('Done.');
});
```

### Testing error handling

```typescript
it('emits agent:error on failure', async () => {
  const { agent } = createTestAgent(MyAgent);
  const events = captureEvents(agent);

  // Override invokeAgent to force an error
  const original = agent.invokeAgent.bind(agent);
  agent.invokeAgent = async () => { throw new Error('boom'); };

  try {
    await agent.invokeAgent({ message: 'test', conversationId: 'c1' });
  } catch {
    // expected
  }

  events.assertEvent('agent:error');
  events.stop();
});
```
