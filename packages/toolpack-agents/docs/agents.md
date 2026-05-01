# Agents — Creating and Running Agents

## Contents

- [BaseAgent — the foundation](#baseagent--the-foundation)
- [Required properties](#required-properties)
- [Optional properties](#optional-properties)
- [Constructor options](#constructor-options)
- [invokeAgent — your business logic](#invokeagent--your-business-logic)
- [run() — calling the LLM](#run--calling-the-llm)
- [Lifecycle hooks](#lifecycle-hooks)
- [Events](#events)
- [Single-agent deployment](#single-agent-deployment)
- [Built-in concrete agents](#built-in-concrete-agents)

---

## BaseAgent — the foundation

Every agent extends `BaseAgent`. It is an abstract class that handles channel binding, interceptor composition, conversation history assembly, LLM invocation, and cross-agent communication.

```typescript
import { BaseAgent, AgentInput, AgentResult } from '@toolpack-sdk/agents';

class MyAgent extends BaseAgent {
  name = 'my-agent';
  description = 'Does something useful';
  mode = 'chat';                        // toolpack-sdk mode

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    return this.run(input.message ?? 'Hello');
  }
}
```

---

## Required properties

These three abstract properties must be set on every agent.

| Property | Type | Purpose |
|---|---|---|
| `name` | `string` | Unique identifier. Used by `AgentRegistry`, delegation, and history. |
| `description` | `string` | Human-readable summary. Surfaced in registry search results. |
| `mode` | `ModeConfig \| string` | Toolpack SDK mode: `'chat'`, `'agent'`, `'coding'`, etc. Controls which tools the LLM has access to. Pass a `ModeConfig` object to customise the system prompt. |

---

## Optional properties

```typescript
import { CHAT_MODE } from 'toolpack-sdk';

class MyAgent extends BaseAgent {
  name = 'my-agent';
  description = '...';

  // Pass a ModeConfig to set a custom system prompt
  mode = {
    ...CHAT_MODE,
    systemPrompt: 'You are a helpful support assistant. Always be concise.',
  };

  // Override provider and model for this agent only
  provider = 'anthropic';
  model = 'claude-opus-4-7';

  // Workflow config merged on top of mode config
  workflow = { maxSteps: 5 };

  // History store — defaults to InMemoryConversationStore
  // Replace with a DB-backed implementation for production
  conversationHistory = new InMemoryConversationStore({ maxMessagesPerConversation: 500 });

  // Options forwarded to assemblePrompt() on every run()
  assemblerOptions = {
    tokenBudget: 4000,
    addressedOnlyMode: true,
    rollingSummaryThreshold: 30,
  };

  // Channels this agent listens on (can also be set after construction)
  channels = [slackChannel, scheduledChannel];

  // Interceptors applied before invokeAgent is called
  interceptors = [
    createEventDedupInterceptor({ maxCacheSize: 500 }),
    createRateLimitInterceptor({
      getKey: (input) => input.participant?.id ?? 'global',
      tokensPerInterval: 10,
      interval: 60000,
    }),
  ];
}
```

### `mode` values

The `mode` property accepts either a string shorthand or a full `ModeConfig` object.

**String shorthand** — uses the built-in mode with its default system prompt:

| Mode string | Typical use |
|---|---|
| `'chat'` | Conversational Q&A, no heavy tool use |
| `'agent'` | Research, data, or general agentic tasks with tools |
| `'coding'` | Code generation, refactoring, review |

**`ModeConfig` object** — spread a built-in mode and override `systemPrompt` (or any other field):

```typescript
import { CHAT_MODE, AGENT_MODE, CODING_MODE } from 'toolpack-sdk';

class MyAgent extends BaseAgent {
  mode = {
    ...CHAT_MODE,
    systemPrompt: 'You are a specialist in semiconductor industry research.',
  };
}
```

The mode determines which tools (web.*, db.*, fs.*, etc.) are available to the LLM.

---

## Constructor options

Two ways to construct an agent:

### Option A — agent owns its Toolpack instance

```typescript
const agent = new MyAgent({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  provider: 'anthropic',              // optional, defaults to 'anthropic'
  model: 'claude-sonnet-4-6',         // optional, uses provider default
});
```

The Toolpack instance is created lazily when `agent.start()` is called.

### Option B — share a Toolpack instance

```typescript
import { Toolpack } from 'toolpack-sdk';

const toolpack = await Toolpack.init({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const agentA = new AgentA({ toolpack });
const agentB = new AgentB({ toolpack });
```

Useful when multiple agents share the same API client configuration. `AgentRegistry` uses this pattern internally.

---

## invokeAgent — your business logic

`invokeAgent` is the single required method to implement. The agent framework calls it after the interceptor chain approves a message.

```typescript
async invokeAgent(input: AgentInput<TIntent>): Promise<AgentResult>
```

### `AgentInput<TIntent>`

```typescript
interface AgentInput<TIntent extends string = string> {
  intent?: TIntent;                    // typed routing hint (e.g. 'billing', 'refund')
  message?: string;                    // natural language from the user
  data?: unknown;                      // structured payload from the channel
  context?: Record<string, unknown>;   // extra context (delegatedBy, threadId, etc.)
  conversationId?: string;             // session/thread identifier for history
  participant?: Participant;           // who sent the message
}
```

### `AgentResult`

```typescript
interface AgentResult {
  output: string;                      // the agent's text response
  steps?: WorkflowStep[];              // execution plan steps (populated by run())
  metadata?: Record<string, unknown>;  // hints for routing or post-processing
}
```

### Routing by intent

Use TypeScript generics to get compile-time intent safety:

```typescript
type SupportIntent = 'billing' | 'refund' | 'technical' | 'general';

class SupportAgent extends BaseAgent<SupportIntent> {
  name = 'support-agent';
  description = 'Customer support assistant';
  mode = 'chat';

  async invokeAgent(input: AgentInput<SupportIntent>): Promise<AgentResult> {
    switch (input.intent) {
      case 'billing':
        return this.run(`Handle billing query: ${input.message}`);
      case 'refund':
        return this.handleRefund(input);
      default:
        return this.run(input.message ?? '');
    }
  }
}
```

### Handling pending asks

When using `ask()` for human-in-the-loop, check for pending asks at the start of `invokeAgent`:

```typescript
async invokeAgent(input: AgentInput): Promise<AgentResult> {
  const pending = this.getPendingAsk(input.conversationId);
  if (pending && input.message) {
    return this.handlePendingAsk(
      pending,
      input.message,
      (answer) => this.continueWithAnswer(answer),
    );
  }
  // Normal flow...
  return this.run(input.message ?? '');
}
```

---

## run() — calling the LLM

`run()` is the protected helper that drives LLM invocation. It handles:

1. Switching the Toolpack mode to `this.mode`
2. Loading conversation history via `assemblePrompt()`
3. Adding a `conversation_search` tool so the LLM can retrieve specific past turns
4. Calling `toolpack.generate()` with the assembled messages
5. Emitting lifecycle events

The system prompt comes from `this.mode.systemPrompt` (when `mode` is a `ModeConfig`) and is injected by the Toolpack client — not set as a class-level property.

```typescript
protected async run(
  message: string,
  options?: AgentRunOptions,
  context?: { conversationId?: string },
): Promise<AgentResult>
```

### Passing a conversationId explicitly

When an agent handles multiple concurrent conversations it is safest to pass `conversationId` explicitly via the third argument to avoid a race on the instance-level `_conversationId` field:

```typescript
async invokeAgent(input: AgentInput): Promise<AgentResult> {
  return this.run(
    input.message ?? '',
    undefined,
    { conversationId: input.conversationId },
  );
}
```

### conversation_search tool

`run()` automatically exposes a `conversation_search` tool to the LLM whenever a `conversationId` is active. The LLM can call it to retrieve specific past turns beyond the assembled context window.

**Security invariant**: the tool uses a closure-captured `conversationId` and never accepts one from LLM arguments, preventing prompt injection that could reach other conversations.

---

## Lifecycle hooks

Override these no-op hooks in your agent to react to execution stages:

```typescript
// Called before run() starts — use to validate input or log
async onBeforeRun(input: AgentInput): Promise<void> {}

// Called after each workflow step completes
async onStepComplete(step: WorkflowStep): Promise<void> {}

// Called when run() finishes successfully
async onComplete(result: AgentResult): Promise<void> {}

// Called when run() throws — re-throw to propagate
async onError(error: Error): Promise<void> {}
```

Example — logging step progress:

```typescript
async onStepComplete(step: WorkflowStep): Promise<void> {
  console.log(`[${this.name}] Step ${step.number}: ${step.description} → ${step.status}`);
}
```

---

## Events

`BaseAgent` extends `EventEmitter`. Typed events:

| Event | Payload | When |
|---|---|---|
| `agent:start` | `{ message: string }` | Before LLM call |
| `agent:complete` | `AgentResult` | After successful completion |
| `agent:error` | `Error` | On any error |

> **Note**: `AgentEvents` also declares `'agent:step'` (payload: `WorkflowStep`) but the built-in `run()` does not currently emit it. If you need per-step callbacks, use the `onStepComplete` lifecycle hook instead.

```typescript
agent.on('agent:complete', (result) => {
  metrics.track('agent.complete', { output_length: result.output.length });
});

agent.on('agent:error', (err) => {
  alerting.notify('Agent error', err.message);
});
```

---

## Single-agent deployment

For a single agent you do not need `AgentRegistry`. Just call `agent.start()` directly.

```typescript
const agent = new MyAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });

agent.channels = [
  new SlackChannel({ name: 'slack', token: '...', signingSecret: '...', channel: '#general' }),
];

await agent.start();

// When shutting down:
await agent.stop();
```

**Note**: Without a registry, `sendTo()`, `ask()`, and `delegate()` will throw because they require `_registry` to be set. To use those features you need `AgentRegistry`.

---

## Built-in concrete agents

Four ready-made agents cover common use cases. Use them directly or extend them.

### ResearchAgent

```typescript
import { ResearchAgent } from '@toolpack-sdk/agents';

const agent = new ResearchAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
// name: 'research-agent'
// mode: 'agent'
// Equipped with web.search, web.fetch, web.scrape tools
```

Best for: web research, fact-finding, summarisation of online sources.

### CodingAgent

```typescript
import { CodingAgent } from '@toolpack-sdk/agents';

const agent = new CodingAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
// name: 'coding-agent'
// mode: 'coding'
// Equipped with coding.*, fs.*, git.* tools
```

Best for: code generation, refactoring, testing, code review.

### DataAgent

```typescript
import { DataAgent } from '@toolpack-sdk/agents';

const agent = new DataAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
// name: 'data-agent'
// mode: 'agent'
// Equipped with db.*, fs.*, http.* tools
```

Best for: database queries, CSV analysis, reporting, data aggregation.

### BrowserAgent

```typescript
import { BrowserAgent } from '@toolpack-sdk/agents';

const agent = new BrowserAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
// name: 'browser-agent'
// mode: 'chat'
// Equipped with web.fetch, web.screenshot, web.extract_links tools
```

Best for: web interaction, form filling, page content extraction, link following.

### Extending a built-in agent

```typescript
import { AGENT_MODE } from 'toolpack-sdk';

class MyResearcher extends ResearchAgent {
  name = 'my-researcher';
  description = 'Specialized research agent for our domain';
  mode = {
    ...AGENT_MODE,
    systemPrompt: 'You are a specialist in semiconductor industry research...',
  };

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    // Add pre-processing
    const enrichedMessage = `[Domain: semiconductors] ${input.message}`;
    return this.run(enrichedMessage);
  }
}
```

---

## WorkflowStep shape

When Toolpack returns a structured plan, `run()` extracts steps and includes them in `AgentResult.steps`:

```typescript
interface WorkflowStep {
  number: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: {
    success: boolean;
    output?: string;
    error?: string;
    toolsUsed?: string[];
    duration?: number;
  };
}
```
