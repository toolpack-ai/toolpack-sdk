# Human-in-the-Loop — ask() and Pending Asks

The `ask()` pattern lets an agent pause mid-execution, send a question to a human over a channel, and resume when the human replies. This is useful for confirmation steps, clarification requests, or approval gates.

## Contents

- [How it works](#how-it-works)
- [ask()](#ask)
- [PendingAsk shape](#pendingask-shape)
- [getPendingAsk()](#getpendingask)
- [handlePendingAsk()](#handlependingask)
- [evaluateAnswer()](#evaluateanswer)
- [resolvePendingAsk()](#resolvependingask)
- [Constraints](#constraints)
- [Full example](#full-example)

---

## How it works

```
User message arrives
        │
        ▼
  invokeAgent()
        │
        ├─ check for pending ask ─────────────────────────────┐
        │  (no pending ask)                                    │
        │                                              (pending ask exists)
        ▼                                                      │
  do some work...                                             ▼
        │                                          handlePendingAsk()
        ▼                                                      │
  this.ask('What is your order number?')           ├─ evaluateAnswer()
        │                                          │          │
        ▼                                          │   (sufficient)
  registry.addPendingAsk(...)                      │          │
  this.sendTo(channelName, question)               │          ▼
        │                                          │  continue with answer
        ▼                                          │
  returns { metadata: { waitingForHuman: true } }  │   (insufficient + retries left)
                                                   │          │
                                                   │          ▼
Human replies (new message in same conversation)   │  ask again with clarification
        │                                          │
        ▼                                (retries exhausted)
  invokeAgent()                                    │
        │                                          ▼
        ├─ getPendingAsk() ─────────────► skip step with message
        │  (pending ask found)
        ▼
  handlePendingAsk(pending, reply, onSufficient)
```

---

## ask()

`ask()` is a protected method on `BaseAgent`. It:

1. Creates a `PendingAsk` record in the registry.
2. Sends the question to the triggering channel via `this.sendTo()`.
3. Returns immediately with `{ metadata: { waitingForHuman: true, askId } }`.

The agent is **not** suspended in a literal async sense — execution continues and the current invocation returns. When the human replies, it arrives as a new message to `invokeAgent()`.

```typescript
protected async ask(
  question: string,
  options?: {
    context?: Record<string, unknown>;    // developer state to persist alongside the ask
    maxRetries?: number;                  // max re-ask attempts (default: 2)
    expiresIn?: number;                   // ms until ask expires (default: never)
  },
): Promise<AgentResult>
```

```typescript
// Inside invokeAgent():
const result = await this.ask('What is your order number?', {
  context: { intent: 'refund', productId: '123' },
  maxRetries: 2,
  expiresIn: 10 * 60 * 1000,  // 10 minutes
});
// result.metadata.waitingForHuman === true
return result;
```

---

## PendingAsk shape

```typescript
interface PendingAsk {
  id: string;                         // UUID
  conversationId: string;             // ties ask to the thread
  agentName: string;                  // agent that created the ask
  question: string;                   // the question sent to the human
  context: Record<string, unknown>;   // developer-stored state
  status: 'pending' | 'answered' | 'expired';
  answer?: string;                    // human's answer (when answered)
  retries: number;                    // current retry count
  maxRetries: number;
  askedAt: Date;
  expiresAt?: Date;
  channelName: string;                // channel for sending follow-up questions
}
```

---

## getPendingAsk()

Check whether a conversation has an outstanding ask. Call this at the **start** of `invokeAgent()` to detect incoming replies.

```typescript
protected getPendingAsk(conversationId?: string): PendingAsk | null
```

```typescript
async invokeAgent(input: AgentInput): Promise<AgentResult> {
  // Check for pending ask first
  const pending = this.getPendingAsk(input.conversationId);
  if (pending && input.message) {
    return this.handlePendingAsk(
      pending,
      input.message,
      (answer) => this.processWithAnswer(answer, pending.context),
    );
  }

  // Normal flow
  return this.run(input.message ?? '');
}
```

---

## handlePendingAsk()

`handlePendingAsk()` handles the complete retry/resolution lifecycle for a pending ask.

```typescript
protected async handlePendingAsk(
  pending: PendingAsk,
  reply: string,
  onSufficient: (answer: string) => Promise<AgentResult> | AgentResult,
  onInsufficient?: () => Promise<AgentResult> | AgentResult,
): Promise<AgentResult>
```

**What it does:**

1. Calls `evaluateAnswer(pending.question, reply)` to check if the reply is sufficient.
2. **Sufficient** — calls `resolvePendingAsk(pending.id, reply)` and then calls `onSufficient(reply)`.
3. **Insufficient, retries left** — increments retry count, calls `ask()` again with a clarification prompt.
4. **Insufficient, retries exhausted** — resolves with `'__insufficient__'`, sends "skipping" message, calls `onInsufficient()` if provided; otherwise returns `{ output: 'Step skipped due to insufficient input.' }`.

```typescript
return this.handlePendingAsk(
  pending,
  input.message!,
  async (answer) => {
    // Happy path — process the confirmed order number
    const order = await this.lookupOrder(answer);
    return { output: `Order ${answer} found: ${order.status}` };
  },
  async () => {
    // Give up gracefully
    return { output: 'Unable to process without an order number. Please start over.' };
  },
);
```

---

## evaluateAnswer()

Validates whether a reply sufficiently addresses a question. Used internally by `handlePendingAsk()`.

```typescript
protected async evaluateAnswer(
  question: string,
  answer: string,
  options?: {
    simpleValidation?: (answer: string) => boolean;
  },
): Promise<boolean>
```

- If `simpleValidation` is provided, uses it directly (no LLM call).
- Otherwise, uses `this.run()` to ask the LLM: `"Is this answer sufficient? Reply ONLY 'yes' or 'no'."`.

For most cases, `simpleValidation` is preferable to avoid the overhead of an extra LLM call:

```typescript
await this.evaluateAnswer('What is your order number?', reply, {
  simpleValidation: (a) => /^\d{5,10}$/.test(a.trim()),
});
```

---

## resolvePendingAsk()

Mark a pending ask as answered with the human's reply.

```typescript
protected async resolvePendingAsk(id: string, answer: string): Promise<void>
```

Call this when you decide to accept the answer (even if not using `handlePendingAsk`):

```typescript
await this.resolvePendingAsk(pending.id, reply);
```

---

## Constraints

**Cannot use `ask()` from trigger channels**

`ScheduledChannel` and `EmailChannel` have `isTriggerChannel = true`. Calling `ask()` inside a scheduled trigger throws:

```
AgentError: this.ask() called from a trigger channel (ScheduledChannel).
Trigger channels have no human recipient.
```

**Requires AgentRegistry**

`ask()` uses `this._registry` to store the pending ask and `this._triggeringChannel` to route the question. Both are set by `AgentRegistry.start()`. Calling `ask()` on a standalone agent (not in a registry) throws:

```
AgentError: Agent not registered - cannot use ask()
```

**Conversation ID required**

`ask()` requires a `conversationId` so it can route the human's reply back to the correct pending ask. Messages without a `conversationId` are rejected before reaching `invokeAgent()`.

---

## Full example

```typescript
type SupportIntent = 'refund' | 'general';

class SupportAgent extends BaseAgent<SupportIntent> {
  name = 'support-agent';
  description = 'Customer support with confirmation flow';
  mode = 'chat';
  systemPrompt = 'You are a helpful customer support agent.';

  async invokeAgent(input: AgentInput<SupportIntent>): Promise<AgentResult> {
    // 1. Handle replies to pending asks
    const pending = this.getPendingAsk(input.conversationId);
    if (pending && input.message) {
      return this.handlePendingAsk(
        pending,
        input.message,
        async (orderNumber) => {
          const refundResult = await this.processRefund(orderNumber, pending.context);
          return { output: `Refund for order ${orderNumber} has been processed: ${refundResult}` };
        },
        async () => ({
          output: 'Unable to process the refund without a valid order number.',
        }),
      );
    }

    // 2. Route by intent
    if (input.intent === 'refund') {
      // Ask for confirmation before proceeding
      return this.ask('Please provide your order number to process the refund.', {
        context: { intent: 'refund', userId: input.participant?.id },
        maxRetries: 3,
        expiresIn: 15 * 60 * 1000,  // 15 minutes
      });
    }

    // 3. General queries
    return this.run(input.message ?? '');
  }

  private async processRefund(orderNumber: string, context: Record<string, unknown>): Promise<string> {
    // ... refund logic
    return 'approved';
  }
}
```
