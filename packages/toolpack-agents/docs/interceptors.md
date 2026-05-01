# Interceptors — Composable Middleware

Interceptors are middleware functions that run before `invokeAgent()` is called. They can modify the input, skip processing entirely, delegate to another agent, or short-circuit with a response. The system is inspired by Koa-style middleware with a `next()` function.

## Contents

- [Interceptor type](#interceptor-type)
- [InterceptorContext](#interceptorcontext)
- [SKIP_SENTINEL](#skip_sentinel)
- [Composing and executing chains](#composing-and-executing-chains)
- [Automatic capture interceptor](#automatic-capture-interceptor)
- [Built-in interceptors](#built-in-interceptors)
  - [createEventDedupInterceptor](#createeventdedupinterceptor)
  - [createNoiseFilterInterceptor](#createnoisefilterinterceptor)
  - [createSelfFilterInterceptor](#createselffilterinterceptor)
  - [createRateLimitInterceptor](#createratelimitinterceptor)
  - [createParticipantResolverInterceptor](#createparticipantresolverinterceptor)
  - [createCaptureInterceptor](#createcaptureinterceptor)
  - [createAddressCheckInterceptor](#createaddresscheckinterceptor)
  - [createIntentClassifierInterceptor](#createintentclassifierinterceptor)
  - [createDepthGuardInterceptor](#createdepthguardinterceptor)
  - [createTracerInterceptor](#createtracerinterceptor)
- [Writing a custom interceptor](#writing-a-custom-interceptor)

---

## Interceptor type

```typescript
type Interceptor = (
  input: AgentInput,
  ctx: InterceptorContext,
  next: NextFunction,
) => Promise<InterceptorResult>;

type NextFunction = (input?: AgentInput) => Promise<InterceptorResult>;
type InterceptorResult = AgentResult | typeof SKIP_SENTINEL;
```

An interceptor either:
- **Calls `next(input?)`** to pass control to the next interceptor (or ultimately `invokeAgent`).
- **Returns `ctx.skip()`** (`SKIP_SENTINEL`) to drop the message entirely — no response sent.
- **Returns an `AgentResult`** directly to short-circuit `invokeAgent` and send that result as the response.

---

## InterceptorContext

```typescript
interface InterceptorContext {
  agent: AgentInstance;
  channel: ChannelInterface;
  registry: IAgentRegistry | null;
  invocationDepth: number;

  // Delegate to another agent and wait for result
  delegateAndWait(agentName: string, input: Partial<AgentInput>): Promise<AgentResult>;

  // Return this to skip processing
  skip(): typeof SKIP_SENTINEL;

  // Structured logger (provided by chain infrastructure, not always present)
  logger?: {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}
```

---

## SKIP_SENTINEL

`SKIP_SENTINEL` is a unique symbol. When an interceptor returns it, the framework:
1. Does not call `invokeAgent()`.
2. Does not send anything to the channel.
3. The message is silently dropped.

Use it to filter out noise, duplicates, or messages not addressed to this agent.

```typescript
import { isSkipSentinel, skip } from '@toolpack-sdk/agents';

const myInterceptor: Interceptor = async (input, ctx, next) => {
  if (shouldIgnore(input)) {
    return ctx.skip();             // or return skip()
  }
  return next(input);
};
```

---

## Composing and executing chains

`BaseAgent` handles chain composition internally. If you need to test or invoke a chain manually:

```typescript
import { composeChain, executeChain } from '@toolpack-sdk/agents';

const chain = composeChain(
  interceptors,    // Interceptor[]
  agent,           // AgentInstance
  channel,         // ChannelInterface
  registry,        // IAgentRegistry | null
  { maxInvocationDepth: 5 },
);

const result = await executeChain(chain, input);
// result is null when SKIP_SENTINEL, otherwise AgentResult
```

---

## Automatic capture interceptor

`BaseAgent._getEffectiveInterceptors()` **always prepends** a `createCaptureInterceptor` to the chain, unless one is already present (detected via `CAPTURE_INTERCEPTOR_MARKER`). This means:

- You do **not** need to add `createCaptureInterceptor` manually.
- Every inbound message and every agent reply is recorded automatically.
- If you want custom capture behaviour, add your own `createCaptureInterceptor` — the auto-prepend will see the marker and skip adding a second one.

---

## Built-in interceptors

### createEventDedupInterceptor

Drops duplicate events based on an event ID extracted from `input.context?.eventId`. Prevents Slack/Telegram delivery retries from triggering the agent multiple times.

```typescript
import { createEventDedupInterceptor } from '@toolpack-sdk/agents';

export interface EventDedupConfig {
  maxCacheSize?: number;                                        // LRU cache size (default: 1000)
  getEventId?: (input: AgentInput) => string | undefined;      // custom ID extractor
  onDuplicate?: (eventId: string, input: AgentInput) => void;  // callback on duplicate
}

agent.interceptors = [
  createEventDedupInterceptor({
    maxCacheSize: 500,
    getEventId: (input) => input.context?.slackEventId as string,
  }),
];
```

The default `getEventId` reads `input.context?.eventId`. If your channel stores the platform event ID elsewhere, supply a custom extractor.

---

### createNoiseFilterInterceptor

Drops messages by subtype. Useful for silently ignoring message edits, deletions, and other noise events.

```typescript
import { createNoiseFilterInterceptor } from '@toolpack-sdk/agents';

export interface NoiseFilterConfig {
  denySubtypes: string[];                                       // required — list of subtypes to drop
  getSubtype?: (input: AgentInput) => string | undefined;      // custom subtype extractor
  onFiltered?: (subtype: string, input: AgentInput) => void;   // callback when filtered
}

agent.interceptors = [
  createNoiseFilterInterceptor({
    denySubtypes: ['message_changed', 'message_deleted', 'bot_message'],
  }),
];
```

The default `getSubtype` reads `input.context?.subtype`. `denySubtypes` is **required** (no default).

---

### createSelfFilterInterceptor

Prevents the agent from responding to its own messages — stops feedback loops.

```typescript
import { createSelfFilterInterceptor } from '@toolpack-sdk/agents';

export interface SelfFilterConfig {
  agentId?: string;                                            // optional, defaults to ctx.agent.name
  getSenderId: (input: AgentInput) => string | undefined;     // required — extract sender ID
  onSelfMessage?: (senderId: string, input: AgentInput) => void;
}

agent.interceptors = [
  createSelfFilterInterceptor({
    agentId: 'U123BOT',                                       // Slack botUserId
    getSenderId: (input) => input.context?.senderId as string,
  }),
];
```

`getSenderId` is **required** — you must tell the interceptor how to extract the sender from your channel's context. `agentId` is optional and defaults to `ctx.agent.name` (the agent's `name` string).

---

### createRateLimitInterceptor

Token-bucket rate limiter per entity. Each key gets its own bucket; `getKey` is **required**.

```typescript
import { createRateLimitInterceptor } from '@toolpack-sdk/agents';

export interface RateLimitConfig {
  getKey: (input: AgentInput) => string;      // required — bucket key (e.g. user ID)
  tokensPerInterval?: number;                  // bucket refill & capacity (default: 10)
  interval?: number;                           // refill interval in ms (default: 60000)
  maxBuckets?: number;                         // LRU cache size (default: 1000)
  onExceeded?: 'skip' | 'reject';             // 'skip' silently drops; 'reject' throws (default: 'skip')
  onRateLimited?: (key: string, input: AgentInput) => void;
}

agent.interceptors = [
  createRateLimitInterceptor({
    getKey: (input) => input.participant?.id ?? input.conversationId ?? 'global',
    tokensPerInterval: 5,   // 5 messages per minute per user
    interval: 60000,
  }),
];
```

Note: there is no `requestsPerMinute` shorthand — use `tokensPerInterval` + `interval` together.

---

### createParticipantResolverInterceptor

Enriches `input.participant` by calling the channel's `resolveParticipant()` or a custom resolver function.

```typescript
import { createParticipantResolverInterceptor } from '@toolpack-sdk/agents';

export interface ParticipantResolverConfig {
  // Optional: explicit resolver; if omitted uses channel.resolveParticipant()
  resolveParticipant?: (input: AgentInput) => Participant | undefined | Promise<Participant | undefined>;
  // Called after successful resolution (for logging/metrics)
  onResolved?: (input: AgentInput, participant: Participant) => void;
}

agent.interceptors = [
  createParticipantResolverInterceptor(),                           // auto-uses channel.resolveParticipant()

  // or with a custom resolver:
  createParticipantResolverInterceptor({
    resolveParticipant: async (input) => ({
      kind: 'user',
      id: input.context?.userId as string,
      displayName: await fetchDisplayName(input.context?.userId as string),
    }),
  }),
];
```

Resolution order: (1) `config.resolveParticipant` if provided, (2) `ctx.channel.resolveParticipant()` if the channel implements it, (3) whatever `channel.normalize()` already placed on `input.participant`. Failures in the resolver are non-fatal — the pipeline continues unchanged.

---

### createCaptureInterceptor

Records inbound messages and outbound replies to the `ConversationStore`. **Auto-prepended** by `BaseAgent` — you rarely need to add this manually.

```typescript
import { createCaptureInterceptor } from '@toolpack-sdk/agents';

export interface CaptureHistoryConfig {
  store: ConversationStore;                                  // required
  getScope?: (input: AgentInput) => ConversationScope;      // default: infers from context.channelType / context.threadId
  getMessageId?: (input: AgentInput) => string;             // default: context.messageId ?? context.eventId ?? randomUUID()
  getMentions?: (input: AgentInput) => string[];            // default: context.mentions ?? []
  onCaptured?: (message: StoredMessage) => void;            // callback after write
  captureAgentReplies?: boolean;                            // also write agent replies (default: true)
}

// Manual usage (usually not needed):
agent.interceptors = [
  createCaptureInterceptor({
    store: agent.conversationHistory,
    getScope: (input) => input.context?.channelType === 'im' ? 'dm' : 'channel',
  }),
];
```

The interceptor writes the inbound message **before** calling `next()`, and writes the agent's reply **after** `next()` returns. Both writes are non-fatal. Marked with `CAPTURE_INTERCEPTOR_MARKER` to prevent double-registration.

**Default scope inference**: reads `input.context?.channelType` — `'im'`/`'private'`/`'dm'` → `'dm'`; presence of `context.threadId` → `'thread'`; otherwise → `'channel'`.

---

### createAddressCheckInterceptor

Classifies whether a message is addressed to this agent using heuristic pattern matching. **Important**: this interceptor enriches the input and always calls `next()`. It does NOT skip on its own — it stores the classification in `input.context._addressCheck` for the `createIntentClassifierInterceptor` to act on.

```typescript
import { createAddressCheckInterceptor } from '@toolpack-sdk/agents';

export type AddressCheckResult = 'direct' | 'indirect' | 'passive' | 'ignore' | 'ambiguous';

export interface AddressCheckConfig {
  agentName: string;                                          // required — agent's display name
  agentId?: string;                                           // optional — platform user/bot ID
  getMessageText: (input: AgentInput) => string | undefined; // required — extract message text
  isDirectMessage?: (input: AgentInput) => boolean;          // DMs are always classified 'direct'
  getMentions?: (input: AgentInput) => string[];             // extract @mention IDs
  onClassified?: (result: AddressCheckResult, input: AgentInput) => void;
}

agent.interceptors = [
  createAddressCheckInterceptor({
    agentName: 'support-agent',
    agentId: 'U123BOT',
    getMessageText: (input) => input.message ?? '',
    isDirectMessage: (input) => input.context?.channelType === 'im',
    getMentions: (input) => input.context?.mentions as string[] ?? [],
  }),
];
```

### Classification heuristics

| Rule checked | Classification |
|---|---|
| `isDirectMessage(input)` returns true | `'direct'` |
| Message starts with `@agentName` or `@agentId` | `'direct'` |
| Message contains `the/my/our agentName` pattern | `'ambiguous'` |
| Agent name appears only inside code blocks | `'ignore'` |
| Message is a bare URL | `'ignore'` |
| Agent is mentioned alongside other agents | `'indirect'` |
| Agent name is mentioned somewhere | `'ambiguous'` |
| No agent mention found | `'passive'` |

The classification is written to `input.context._addressCheck`. Pair with `createIntentClassifierInterceptor` (see next) to act on it.

---

### createIntentClassifierInterceptor

Reads the `_addressCheck` classification set by `createAddressCheckInterceptor` and decides whether to skip or proceed. For `'ambiguous'` and `'indirect'` cases it delegates to an `IntentClassifierAgent` for LLM-based disambiguation.

```typescript
import { createIntentClassifierInterceptor } from '@toolpack-sdk/agents';

export interface IntentClassifierInterceptorConfig {
  agentName: string;                                           // required
  agentId: string;                                             // required
  getMessageText: (input: AgentInput) => string | undefined;  // required
  getSenderName: (input: AgentInput) => string;               // required
  getChannelName: (input: AgentInput) => string;              // required
  classifierAgentName?: string;                               // default: 'intent-classifier'
  isDirectMessage?: (input: AgentInput) => boolean;
  getRecentContext?: (input: AgentInput) => Array<{ sender: string; content: string }>;
  onClassified?: (classification: IntentClassification, input: AgentInput) => void;
}

agent.interceptors = [
  // Must come first — writes _addressCheck to context
  createAddressCheckInterceptor({
    agentName: 'support-agent',
    agentId: 'U123BOT',
    getMessageText: (input) => input.message ?? '',
  }),
  // Reads _addressCheck; skips passive/ignore; calls LLM for ambiguous/indirect
  createIntentClassifierInterceptor({
    agentName: 'support-agent',
    agentId: 'U123BOT',
    getMessageText: (input) => input.message ?? '',
    getSenderName: (input) => input.participant?.displayName ?? 'Unknown',
    getChannelName: (input) => input.context?.channelName as string ?? 'general',
  }),
];
```

### Behaviour table

| `_addressCheck` value | Action |
|---|---|
| `'direct'` | Proceed immediately (no LLM call) |
| `'ignore'` | Skip |
| `'passive'` | Skip |
| `'ambiguous'` | Call `IntentClassifierAgent` → proceed if `'direct'`, skip otherwise |
| `'indirect'` | Call `IntentClassifierAgent` → proceed if `'direct'`, skip otherwise |
| *(not set / no prior address-check)* | Call `IntentClassifierAgent` |

If the classifier call fails, the interceptor falls back to allowing the message.

---

### createDepthGuardInterceptor

Prevents runaway recursion in agent delegation chains.

```typescript
import { createDepthGuardInterceptor } from '@toolpack-sdk/agents';

export interface DepthGuardConfig {
  maxDepth?: number;                                                                   // default: 5
  onDepthExceeded?: (currentDepth: number, maxDepth: number, input: AgentInput) => void;
}

agent.interceptors = [
  createDepthGuardInterceptor({ maxDepth: 5 }),
];
```

When `invocationDepth > maxDepth`, throws `DepthExceededError`. The actual depth protection primarily lives inside the chain composer's `delegateAndWait` — this interceptor is belt-and-suspenders for future scenarios where delegated calls route through the full interceptor chain.

---

### createTracerInterceptor

Structured logging of each chain hop for debugging. Uses `ctx.logger` (from chain context) — no custom logger config.

```typescript
import { createTracerInterceptor } from '@toolpack-sdk/agents';

export interface TracerConfig {
  level?: 'debug' | 'info';              // log level (default: 'debug')
  includeInputData?: boolean;            // log full input (default: false)
  includeResultOutput?: boolean;         // log full result (default: false)
  shouldTrace?: (input: AgentInput) => boolean;  // filter which inputs to trace
}

agent.interceptors = [
  createTracerInterceptor({
    level: 'debug',
    includeInputData: true,
  }),
];
```

Logs entry (before `next()`) and exit (after `next()`) with agent name, channel, depth, conversationId, and duration. To see these logs, wire a logger into the chain context via `composeChain` options.

---

## Writing a custom interceptor

An interceptor is any async function matching the `Interceptor` type:

```typescript
import type { Interceptor } from '@toolpack-sdk/agents';

const auditInterceptor: Interceptor = async (input, ctx, next) => {
  const start = Date.now();

  auditLog.write({ event: 'message_received', conversationId: input.conversationId });

  const result = await next(input);

  if (result !== null) {
    auditLog.write({ event: 'message_handled', duration: Date.now() - start });
  }

  return result;
};

agent.interceptors = [auditInterceptor];
```

### Modifying the input

Pass a modified `AgentInput` to `next()` to transform it before reaching `invokeAgent`:

```typescript
const enrichmentInterceptor: Interceptor = async (input, ctx, next) => {
  const enriched: AgentInput = {
    ...input,
    context: {
      ...input.context,
      userTier: await lookupUserTier(input.participant?.id),
    },
  };
  return next(enriched);
};
```

### Short-circuiting

Return an `AgentResult` directly to bypass `invokeAgent` entirely:

```typescript
const maintenanceModeInterceptor: Interceptor = async (input, ctx, next) => {
  if (maintenanceMode.isActive()) {
    return {
      output: 'The service is currently undergoing maintenance. Please try again later.',
      metadata: { maintenance: true },
    };
  }
  return next(input);
};
```

### Recommended interceptor order

```typescript
agent.interceptors = [
  // 1. Noise/dedup first — cheapest filters, drop junk early
  createEventDedupInterceptor(),
  createNoiseFilterInterceptor({ denySubtypes: ['message_changed', 'message_deleted'] }),
  createSelfFilterInterceptor({
    agentId: 'U123BOT',
    getSenderId: (input) => input.context?.userId as string,
  }),

  // 2. Rate limiting
  createRateLimitInterceptor({
    getKey: (input) => input.participant?.id ?? 'global',
    tokensPerInterval: 20,
    interval: 60000,
  }),

  // 3. Enrichment
  createParticipantResolverInterceptor(),

  // 4. Address check (pattern matching — cheap)
  createAddressCheckInterceptor({
    agentName: agent.name,
    getMessageText: (input) => input.message ?? '',
  }),

  // 5. Intent classification (LLM call only for ambiguous cases)
  createIntentClassifierInterceptor({
    agentName: agent.name,
    agentId: agent.name,
    getMessageText: (input) => input.message ?? '',
    getSenderName: (input) => input.participant?.displayName ?? 'Unknown',
    getChannelName: (input) => input.context?.channelName as string ?? 'general',
  }),

  // 6. Safety guard
  createDepthGuardInterceptor(),

  // 7. Debug (development only)
  // createTracerInterceptor({ level: 'debug' }),
];
// Note: createCaptureInterceptor is auto-prepended before all of these
```
