# Transport & Delegation

The transport layer routes agent-to-agent invocations. It sits between `AgentRegistry` and the individual agents, providing a pluggable mechanism for cross-agent communication.

## Contents

- [AgentTransport interface](#agenttransport-interface)
- [LocalTransport](#localtransport)
- [JsonRpcTransport](#jsonrpctransport)
- [delegate() — fire-and-forget](#delegate--fire-and-forget)
- [delegateAndWait() — synchronous delegation](#delegateandwait--synchronous-delegation)
- [How delegation preserves history](#how-delegation-preserves-history)
- [Delegation depth guard](#delegation-depth-guard)

---

## AgentTransport interface

```typescript
interface AgentTransport {
  invoke(agentName: string, input: AgentInput): Promise<AgentResult>;
}
```

The registry uses the transport to route `invoke()` calls. The default transport is `LocalTransport`.

---

## LocalTransport

In-process delegation. Used automatically when you create an `AgentRegistry` without a transport override.

```typescript
import { LocalTransport } from '@toolpack-sdk/agents';

// Created automatically by AgentRegistry:
const registry = new AgentRegistry([agentA, agentB]);
// registry._transport is a LocalTransport(registry)

// Or create explicitly:
const transport = new LocalTransport(registry);
```

### What it does

When `transport.invoke(agentName, input)` is called:

1. Resolves the target agent from the registry by name.
2. Writes the inbound message to the **target agent's** `ConversationStore` as a `kind: 'agent'` participant (the delegating agent's name).
3. Calls `target.invokeAgent(input)` directly (in-process).
4. Writes the target agent's reply to the target's store as the target agent's own turn.
5. Returns the `AgentResult`.

This means the **target agent has full history** of the delegation exchange, enabling it to use `assemblePrompt()` to understand the conversation context.

---

## JsonRpcTransport

For distributed deployments where agents run in separate processes or on separate servers.

```typescript
import { JsonRpcTransport, AgentJsonRpcServer } from '@toolpack-sdk/agents';

// Client side (calling agent's process)
const transport = new JsonRpcTransport({
  endpoint: 'http://agent-server:8080/rpc',
});

const registry = new AgentRegistry([callerAgent], { transport });

// Server side (target agent's process)
const server = new AgentJsonRpcServer({
  registry: targetRegistry,
  port: 8080,
  path: '/rpc',
});
await server.start();
```

The JSON-RPC protocol transmits `AgentInput` and returns `AgentResult` over HTTP.

---

## delegate() — fire-and-forget

`delegate()` is a protected method on `BaseAgent`. It invokes another agent and **does not wait** for the result. Useful for spawning background work.

```typescript
protected async delegate(agentName: string, input: Partial<AgentInput>): Promise<void>
```

```typescript
// Inside your agent's invokeAgent():
async invokeAgent(input: AgentInput): Promise<AgentResult> {
  // Kick off background analysis — don't wait
  await this.delegate('data-agent', {
    message: `Analyse sales data for ${input.context?.region}`,
    context: { requestedBy: this.name },
  });

  return { output: 'Analysis started. Results will be available shortly.' };
}
```

**What gets set automatically:**

- `context.delegatedBy` is set to `this.name`
- `conversationId` defaults to the current conversation's ID (or a new `delegation-<timestamp>` ID if none)

Errors from the delegated agent are caught and logged but do not propagate to the caller.

---

## delegateAndWait() — synchronous delegation

`delegateAndWait()` invokes another agent and **waits for the result** before continuing.

```typescript
protected async delegateAndWait(agentName: string, input: Partial<AgentInput>): Promise<AgentResult>
```

```typescript
async invokeAgent(input: AgentInput): Promise<AgentResult> {
  // First, get research results
  const research = await this.delegateAndWait('research-agent', {
    message: `Find the latest news on ${input.message}`,
  });

  // Then, use them to generate a report
  const report = await this.run(
    `Based on this research: ${research.output}\n\nWrite a concise report.`
  );

  return report;
}
```

Both `delegate()` and `delegateAndWait()` require the agent to be registered with an `AgentRegistry`. Calling them on a standalone agent (without a registry) throws:

```
AgentError: Agent not registered - cannot use delegate()
```

---

## How delegation preserves history

When agent A delegates to agent B:

```
Agent A                          Agent B
  │                                │
  ├─ delegateAndWait('agent-b')    │
  │                                │
  │  LocalTransport.invoke()       │
  │  ├─ store.append({             │
  │  │    participant: { kind: 'agent', id: 'agent-a' },
  │  │    content: <delegated message>
  │  │  }) → written to Agent B's store
  │  │                             │
  │  └─ agent-b.invokeAgent()     │
  │                               ├─ assemblePrompt reads history
  │                               │  (sees agent-a's delegated message)
  │                               │
  │                               └─ returns result
  │  ├─ store.append({            │
  │  │    participant: { kind: 'agent', id: 'agent-b' },
  │  │    content: <result>
  │  │  }) → written to Agent B's store
  │  │
  │  └─ returns AgentResult to Agent A
```

Agent B's history reflects the full delegation exchange. If agent B is later invoked again in the same conversation, it will have context about what agent A asked.

---

## Delegation depth guard

Circular delegation (A → B → A) is caught by `createDepthGuardInterceptor`. The `invocationDepth` counter in `InterceptorContext` increments with each delegation. When it exceeds `maxDepth` (default 5), a `DepthExceededError` is thrown.

Add `createDepthGuardInterceptor` to your interceptors list for agents that participate in delegation chains:

```typescript
import { createDepthGuardInterceptor } from '@toolpack-sdk/agents';

agent.interceptors = [
  createDepthGuardInterceptor({ maxDepth: 5 }),
];
```

---

## Summary: delegate vs delegateAndWait vs sendTo

| Method | Waits? | Requires registry? | Uses transport? | Target |
|---|---|---|---|---|
| `this.delegate(agentName, input)` | No | Yes | Yes (LocalTransport) | Agent |
| `this.delegateAndWait(agentName, input)` | Yes | Yes | Yes (LocalTransport) | Agent |
| `this.sendTo(channelName, message)` | No | Yes | No | Channel |
| `registry.invoke(agentName, input)` | Yes | — | Yes | Agent |
| `registry.sendTo(channelName, output)` | No | — | No | Channel |
