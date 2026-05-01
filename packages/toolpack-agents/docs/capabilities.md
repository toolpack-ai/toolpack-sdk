# Capability Agents — IntentClassifier and Summarizer

Capability agents are specialised `BaseAgent` subclasses used internally by interceptors and history assembly. They are not channel-facing — register them without `channels` to use them as pure compute workers.

## Contents

- [IntentClassifierAgent](#intentclassifieragent)
- [SummarizerAgent](#summarizerAgent)
- [Using capabilities as standalone agents](#using-capabilities-as-standalone-agents)

---

## IntentClassifierAgent

Classifies whether a message is addressed to a specific agent. Used internally by `createIntentClassifierInterceptor` and `createAddressCheckInterceptor` to handle ambiguous mentions.

### Types

```typescript
import { IntentClassifierAgent, IntentClassifierInput, IntentClassification } from '@toolpack-sdk/agents';

type IntentClassification = 'direct' | 'indirect' | 'passive' | 'ignore';

interface IntentClassifierInput {
  message: string;                     // the message to classify
  agentName: string;                   // agent's display name
  agentId: string;                     // agent's stable identifier
  senderName: string;                  // who sent the message
  channelName: string;                 // channel the message came from
  isDirectMessage?: boolean;           // true for DMs (lower bar for 'direct')
  recentContext?: Array<{              // last few turns for context
    sender: string;
    content: string;
  }>;
  includeExamples?: boolean;           // include few-shot examples in the prompt
}
```

### Classification meanings

| Classification | Meaning |
|---|---|
| `'direct'` | The agent is the explicit intended recipient |
| `'indirect'` | The agent is mentioned but not the primary target |
| `'passive'` | The agent is referenced but not being communicated with |
| `'ignore'` | The message is clearly not meant for this agent |

### Usage

The classifier is typically invoked automatically by interceptors. For manual use:

```typescript
const classifier = new IntentClassifierAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
await classifier._ensureToolpack();

const result = await classifier.invokeAgent({
  data: {
    message: 'Hey @support can you help me with my order?',
    agentName: 'support-agent',
    agentId: 'support-agent',
    senderName: 'Alice',
    channelName: 'general',
    isDirectMessage: false,
    recentContext: [{ sender: 'Bob', content: 'Good morning everyone' }],
  } satisfies IntentClassifierInput,
  conversationId: 'classify-001',
});

// result.output is 'direct' | 'indirect' | 'passive' | 'ignore'
const classification = result.output as IntentClassification;
```

---

## SummarizerAgent

Compresses conversation history into a compact summary. Used by `assemblePrompt()` when the conversation exceeds `rollingSummaryThreshold` turns.

### Types

```typescript
import { SummarizerAgent, SummarizerInput, SummarizerOutput, HistoryTurn } from '@toolpack-sdk/agents';

interface HistoryTurn {
  id: string;
  participant: Participant;
  content: string;
  timestamp: string;
  metadata?: {
    isToolCall?: boolean;
    toolName?: string;
    toolResult?: unknown;
  };
}

interface SummarizerInput {
  turns: HistoryTurn[];                // turns to summarise
  agentName: string;                   // agent's name (for pronoun resolution)
  agentId: string;                     // agent's identifier
  maxTokens?: number;                  // target summary length (default: 500 tokens)
  extractDecisions?: boolean;          // include key decisions in output
}

interface SummarizerOutput {
  summary: string;                     // compressed narrative
  turnsSummarized: number;             // how many turns were compressed
  hasDecisions: boolean;               // whether decisions were extracted
  estimatedTokens: number;             // approximate token count of summary
}
```

### Usage

The summarizer is typically invoked automatically by `assemblePrompt()`. For manual use:

```typescript
import { SummarizerAgent, SummarizerInput } from '@toolpack-sdk/agents';

const summarizer = new SummarizerAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
await summarizer._ensureToolpack();

const result = await summarizer.invokeAgent({
  data: {
    turns: olderTurns,                 // HistoryTurn[] to compress
    agentName: 'support-agent',
    agentId: 'support-agent',
    maxTokens: 500,
    extractDecisions: true,
  } satisfies SummarizerInput,
  conversationId: 'summarize-001',
});

const output = JSON.parse(result.output) as SummarizerOutput;
console.log(output.summary);
console.log(`Compressed ${output.turnsSummarized} turns`);
```

### Wiring into assemblePrompt()

```typescript
import { assemblePrompt, SummarizerAgent } from '@toolpack-sdk/agents';

// Create summarizer once
const summarizer = new SummarizerAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
await summarizer._ensureToolpack();

// In your custom history loading logic
const assembled = await assemblePrompt(
  store,
  conversationId,
  'my-agent',
  'my-agent',
  {
    rollingSummaryThreshold: 30,   // compress when turns > 30
    tokenBudget: 3000,
  },
  summarizer,                       // ← pass the summarizer here
);
```

`assemblePrompt()` calls `SummarizerAgent` automatically when the history slice exceeds `rollingSummaryThreshold`. The resulting summary is inserted as a `system` message before the recent turns in the assembled context.

---

## Using capabilities as standalone agents

Register capability agents without channels. They operate purely as compute workers:

```typescript
const classifier = new IntentClassifierAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
const summarizer = new SummarizerAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });

const registry = new AgentRegistry([
  myMainAgent,
  classifier,    // no channels — pure compute worker
  summarizer,    // no channels — pure compute worker
]);

await registry.start();

// Main agent can delegate to them
// (Usually this happens via interceptors, not direct delegation)
```

Because they extend `BaseAgent`, they get conversation history, lifecycle hooks, and events — but since they have no channels, they can only be invoked via delegation or the registry.

---

## IntentClassifier vs AddressCheck interceptors

| Feature | `createAddressCheckInterceptor` | `createIntentClassifierInterceptor` |
|---|---|---|
| Method | Pattern matching (regex, heuristics) | LLM call |
| Speed | Fast (no API call) | Slower (API call) |
| Best for | Clear @-mentions, DMs | Ambiguous natural language |
| Usage | First-pass filter | Disambiguation of ambiguous cases |

Recommended: chain `createAddressCheckInterceptor` (cheap, pattern-based) immediately before `createIntentClassifierInterceptor` (LLM-based). The intent classifier reads `_addressCheck` from context and only makes an LLM call for `'ambiguous'`/`'indirect'` cases:

```typescript
agent.interceptors = [
  createAddressCheckInterceptor({
    agentName: agent.name,
    getMessageText: (input) => input.message ?? '',
  }),
  createIntentClassifierInterceptor({
    agentName: agent.name,
    agentId: agent.name,
    getMessageText: (input) => input.message ?? '',
    getSenderName: (input) => input.participant?.displayName ?? 'Unknown',
    getChannelName: (input) => input.context?.channelName as string ?? 'general',
  }),
];
```
