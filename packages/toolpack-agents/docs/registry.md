# AgentRegistry — Multi-Agent Coordination

`AgentRegistry` is the optional coordinator for multi-agent deployments. It wires agents together, manages the channel routing table, and provides the shared transport layer for cross-agent delegation.

**You do not need `AgentRegistry` for a single-agent deployment** — just call `agent.start()` directly.

## Contents

- [When to use AgentRegistry](#when-to-use-agentregistry)
- [Construction](#construction)
- [start() and stop()](#start-and-stop)
- [Channel routing](#channel-routing)
- [Agent lookup](#agent-lookup)
- [Invoking agents programmatically](#invoking-agents-programmatically)
- [Pending asks store](#pending-asks-store)
- [Custom transport](#custom-transport)
- [What start() does internally](#what-start-does-internally)

---

## When to use AgentRegistry

Use `AgentRegistry` when:

- You have multiple agents that need to delegate tasks to each other
- You need `sendTo()` across agents — routing output to a channel owned by a different agent
- You want centralised `ask()` / pending-ask resolution
- You want a single `start()` / `stop()` call that manages all agents

---

## Construction

```typescript
import { AgentRegistry } from '@toolpack-sdk/agents';

const registry = new AgentRegistry(
  [agentA, agentB, agentC],   // array of BaseAgent instances
  {
    transport: customTransport, // optional: override LocalTransport
  },
);
```

Each agent already has its own `channels` and `interceptors` configured. The registry does not own those — it just coordinates lifecycle and routing.

---

## start() and stop()

```typescript
await registry.start();

// ... your application runs ...

// Graceful shutdown — stops all channels and releases Toolpack instances
// (Not yet implemented as a single method on registry; call agent.stop() per agent)
for (const agent of registry.getAllAgents()) {
  await (agent as BaseAgent).stop();
}
```

`registry.start()` performs these steps for each agent in order:

1. **Initialise Toolpack** — calls `agent._ensureToolpack()` so the API client is ready before channels start.
2. **Wire registry reference** — sets `agent._registry = this` so `sendTo()`, `ask()`, and `delegate()` work.
3. **Register named channels** — scans each agent's `channels` array and adds named channels to the routing table for `sendTo()`.
4. **Start agent** — calls `agent.start()` which binds message handlers to each channel and calls `channel.listen()`.

---

## Channel routing

Any channel with a `name` property is registered in the routing table and can be targeted by `sendTo()`:

```typescript
// SlackChannel named 'alerts'
const slackAlerts = new SlackChannel({
  name: 'alerts',                          // ← this name is registered
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: '#alerts',
});

// From inside any agent in the registry
await this.sendTo('alerts', 'Deployment completed successfully');
```

`sendTo()` on `AgentRegistry` directly:

```typescript
await registry.sendTo('alerts', { output: 'Server is down', metadata: { severity: 'critical' } });
```

If no channel with that name is registered, `sendTo()` throws.

---

## Agent lookup

```typescript
// Get a specific agent
const agent = registry.getAgent('research-agent');

// Get all agents
const allAgents = registry.getAllAgents();

// Get a channel by name
const channel = registry.getChannel('alerts');
```

---

## Invoking agents programmatically

`registry.invoke()` calls an agent's `invokeAgent()` through the transport layer. Used internally by `agent.delegateAndWait()`.

```typescript
const result = await registry.invoke('research-agent', {
  message: 'What is the latest on TSMC?',
  conversationId: 'conv-123',
});

console.log(result.output);
```

---

## Pending asks store

The registry holds an in-memory store for human-in-the-loop questions (`PendingAsk`). Agents interact with this through `ask()`, `getPendingAsk()`, `handlePendingAsk()` — see [human-in-the-loop.md](human-in-the-loop.md).

Direct registry methods (primarily used internally):

```typescript
// Add a pending ask
const ask = registry.addPendingAsk({
  conversationId: 'conv-123',
  agentName: 'support-agent',
  question: 'Can you confirm your order number?',
  context: {},
  maxRetries: 2,
  channelName: 'support-slack',
});

// Check for pending asks
const hasPending = registry.hasPendingAsks('conv-123');

// Resolve with answer
await registry.resolvePendingAsk(ask.id, '12345');

// Get pending ask for conversation
const pending = registry.getPendingAsk('conv-123');

// Increment retries
const newCount = registry.incrementRetries(ask.id);

// Clean up expired asks (call periodically)
const cleaned = registry.cleanupExpiredAsks();
```

---

## Custom transport

By default the registry uses `LocalTransport` which routes delegation calls in-process. Override with `JsonRpcTransport` for cross-process or network deployments:

```typescript
import { AgentRegistry, JsonRpcTransport } from '@toolpack-sdk/agents';

const registry = new AgentRegistry([agent], {
  transport: new JsonRpcTransport({ endpoint: 'http://agent-server:8080' }),
});
```

See [transport.md](transport.md) for details.

---

## What start() does internally

Sequence diagram for `registry.start()`:

```
registry.start()
  │
  ├─ for each agent:
  │    ├─ agent._ensureToolpack()       // init Toolpack client
  │    ├─ agent._registry = registry   // wire cross-agent features
  │    ├─ instances.set(agent.name, agent)
  │    └─ for each channel with name:
  │         channels.set(channel.name, channel)
  │
  └─ for each agent:
       └─ agent.start()
            ├─ for each channel:
            │    ├─ _bindChannel(channel)   // attach interceptor chain
            │    └─ channel.listen()        // begin accepting messages
            └─ ...
```

The two-pass loop (first wire all registries, then start all agents) ensures that when `agent.start()` triggers the first message, all peer agents and channels are already registered and discoverable via `sendTo()`.
