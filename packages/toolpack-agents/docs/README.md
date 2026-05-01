# toolpack-agents — Complete Guide

`toolpack-agents` is the agent layer of the Toolpack SDK. It provides a consistent, extensible pattern for building, composing, and deploying AI agents that communicate through real-world channels (Slack, Discord, Telegram, webhooks, SMS, scheduled jobs) and collaborate with each other.

## Package

```
@toolpack-sdk/agents   (imported from '@toolpack-sdk/agents' in the monorepo)
```

---

## Architecture at a glance

```
┌──────────────────────────────────────────────────────┐
│                   AgentRegistry                      │
│   Coordinates lifecycle, routing, and delegation     │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  BaseAgent (your custom agent)                  │ │
│  │  ├─ name, description, mode                     │ │
│  │  ├─ systemPrompt, model, provider               │ │
│  │  ├─ channels[]   ──► Channel integrations       │ │
│  │  ├─ interceptors[] ─► Middleware chain           │ │
│  │  ├─ conversationHistory ─► ConversationStore    │ │
│  │  └─ invokeAgent()  ─► your business logic       │ │
│  └─────────────────────────────────────────────────┘ │
│                         │                            │
│       LocalTransport  ◄─┤─► delegate / delegateAndWait │
└──────────────────────────────────────────────────────┘
         │                     │
  External channels      Capability agents
  (Slack, Discord,       (Summarizer, IntentClassifier)
   Telegram, etc.)
```

**Key concepts**

| Concept | Purpose |
|---|---|
| `BaseAgent` | Abstract base for every agent. Extend it to add business logic. |
| `AgentRegistry` | Coordinator for multi-agent deployments. Not needed for a single agent. |
| `ChannelInterface` | Normalises external events → `AgentInput`; delivers `AgentOutput` back. |
| `Interceptor` | Composable middleware (dedup, noise filter, rate limit, history capture…). |
| `ConversationStore` | Persists message history; `assemblePrompt()` reads it to build LLM context. |
| `AgentTransport` | Routes cross-agent invocations (default: `LocalTransport`, in-process). |

---

## Documentation index

| File | What it covers |
|---|---|
| [agents.md](agents.md) | Creating agents — `BaseAgent` API, built-in agents, lifecycle |
| [registry.md](registry.md) | `AgentRegistry` — multi-agent coordination |
| [channels.md](channels.md) | All 7 channel integrations (Slack, Discord, Telegram, Webhook, Scheduled, Email, SMS) |
| [conversation-history.md](conversation-history.md) | Conversation storage, `assemblePrompt`, addressed-only mode |
| [interceptors.md](interceptors.md) | Interceptor system — all 10 built-in interceptors and custom interceptors |
| [transport.md](transport.md) | Transport layer — `LocalTransport`, `JsonRpcTransport`, delegation |
| [human-in-the-loop.md](human-in-the-loop.md) | `ask()` / `handlePendingAsk()` — pausing agents for human input |
| [capabilities.md](capabilities.md) | `IntentClassifierAgent` and `SummarizerAgent` |
| [testing.md](testing.md) | `createTestAgent`, `MockChannel`, `captureEvents` |
| [examples.md](examples.md) | Full end-to-end examples |

---

## Quick install

```bash
npm install @toolpack-sdk/agents toolpack-sdk
```

Peer dependencies are optional — install only what you need:

```bash
# Slack (SlackChannel uses a built-in HTTP server, but @slack/web-api is needed for auth.test)
npm install @slack/web-api

# Discord
npm install discord.js

# Telegram
npm install node-telegram-bot-api

# Email
npm install nodemailer

# SMS
npm install twilio

# Persistent store
npm install better-sqlite3
```

---

## Thirty-second example

```typescript
import { BaseAgent, AgentInput, AgentResult, AgentRegistry, SlackChannel } from '@toolpack-sdk/agents';

class GreetingAgent extends BaseAgent {
  name = 'greeting-agent';
  description = 'Greets users warmly';
  mode = 'chat';

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    return this.run(input.message ?? '');
  }
}

const slack = new SlackChannel({
  name: 'main-slack',
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: '#general',
});

const agent = new GreetingAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
agent.channels = [slack];

const registry = new AgentRegistry([agent]);
await registry.start();
```

For a full walkthrough see [examples.md](examples.md).
