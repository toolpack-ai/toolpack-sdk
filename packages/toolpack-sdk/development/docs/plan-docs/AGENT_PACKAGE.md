# toolpack-agents

A first-class agent layer for the [Toolpack SDK](https://toolpacksdk.com). Build, compose, and deploy AI agents with a consistent, extensible pattern — separate from the core SDK and installable on demand.

---

## Why toolpack-agents?

The Toolpack SDK gives you the primitives — providers, modes, tools, workflows. But as your AI application grows, you need a higher-level abstraction: a reusable, composable, invokable **agent**.

Without a formal agent layer, every team invents their own pattern. `toolpack-agents` gives the ecosystem a shared vocabulary.

```bash
npm install toolpack-agents
```

---

## Core Concepts

### The Five Layers

| Layer | Responsibility |
|---|---|
| **Providers** | Who thinks (OpenAI, Anthropic, Gemini, Ollama) |
| **Modes** | What they can do (tool access, workflow config) |
| **Tools** | How they act (built-in + custom) |
| **Agents** | Who they are (identity, behavior, orchestration) |
| **Channels** | How they communicate (Slack, Telegram, Webhook, Scheduled) |

Agents sit on top of the existing SDK — they don't replace anything. A mode is infrastructure. An agent is a personality built on that infrastructure.

---

## Defining an Agent

Agents are **code, not configuration**. Each agent is a class that extends `BaseAgent`.

```ts
import { BaseAgent, AgentInput, AgentResult } from 'toolpack-agents';

export class CustomerSupportAgent extends BaseAgent {

  name = 'customer-support';
  mode = 'chat';
  systemPrompt = `You are a helpful customer support agent...`;

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    if (input.intent === 'refund_request') {
      return this.handleRefund(input.data);
    }
    return this.run(input.message);
  }

  private async handleRefund(data: unknown) {
    // agent-specific logic
  }
}
```

### Why a class?

- Encapsulates behavior, state, and sub-agent composition in one place
- Supports conditional logic, internal methods, and lifecycle hooks — things a config object cannot express
- Agents become composable: one agent can instantiate and delegate to another
- Developers can extend built-in agents with standard inheritance

---

## Lifecycle Hooks

`BaseAgent` exposes optional hooks for observability and control:

```ts
export class AnalyticsAgent extends BaseAgent {

  async onBeforeRun(input: AgentInput) {
    // validate or transform input before execution
  }

  async onStepComplete(step: WorkflowStep) {
    // called after each workflow step
  }

  async onComplete(result: AgentResult) {
    // post-process or log results
  }

  async onError(error: Error) {
    // handle or report errors
  }
}
```

---

## Coordinator Agents and Sub-Agents

Complex agents can orchestrate multiple specialist sub-agents internally. The coordinator owns the high-level logic; sub-agents own specific capabilities.

```ts
// agents/sub/AnalyticsAgent.ts
export class AnalyticsAgent extends BaseAgent {
  async getEngagementReport() { ... }
  async getTrendingTopics() { ... }
}

// agents/sub/ContentAgent.ts
export class ContentAgent extends BaseAgent {
  async writeBlogPost(brief: string) { ... }
  async writeLinkedInPost(insights: string) { ... }
}

// agents/CoordinatorAgent.ts
export class CoordinatorAgent extends BaseAgent {

  private analytics = new AnalyticsAgent(this.toolpack);
  private content = new ContentAgent(this.toolpack);

  async invokeAgent(input: AgentInput) {
    const insights = await this.analytics.getTrendingTopics();
    const post = await this.content.writeLinkedInPost(insights);
    return post;
  }
}
```

Because agents are just classes, **inter-agent communication is just method calls**. No special protocol needed.

---

## Agent Channels

A channel is the two-way communication layer between the outside world and an agent. It handles incoming messages, normalizes them into `AgentInput`, calls `invokeAgent()`, and can send the agent's response back through the same channel.

```ts
export abstract class BaseChannel {
  abstract listen(): void;                             // outside → agent
  abstract send(message: AgentOutput): Promise<void>;  // agent → outside
  abstract normalize(incoming: unknown): AgentInput;   // normalize to common format
}
```

The agent never knows which channel invoked it. The same agent runs identically whether contacted via Slack, Telegram, a webhook, or a cron schedule.

### Built-in Channels

| Channel | Description |
|---|---|
| `SlackChannel` | Two-way Slack integration — receives messages, replies in-thread |
| `TelegramChannel` | Two-way Telegram bot integration — receives and sends messages |
| `ScheduledChannel` | Runs the agent on a cron schedule |
| `WebhookChannel` | Exposes an HTTP endpoint, responds with agent output |
| `PushChannel` | Receives push notification events, sends push responses |

### Custom Channels

You can create your own channel by extending `BaseChannel`:

```ts
import { BaseChannel, AgentInput, AgentOutput } from 'toolpack-agents';

export class SMSChannel extends BaseChannel {

  async listen() {
    // set up your SMS listener (e.g. Twilio webhook)
  }

  async send(message: AgentOutput) {
    // send the agent's response back via SMS
    await twilioClient.messages.create({
      body: message.output,
      to: this.recipientNumber,
    });
  }

  normalize(incomingEvent: unknown): AgentInput {
    // map the raw event to a standard AgentInput
    return {
      intent: 'sms_message',
      message: (incomingEvent as any).body,
      data: incomingEvent,
    };
  }
}
```

---

## Registering Agents

Agents are registered with the SDK at initialization — the same pattern as custom tools.

### At Initialization

```ts
import { Toolpack } from 'toolpack-sdk';
import { withAgents } from 'toolpack-agents';
import { CustomerSupportAgent } from './agents/CustomerSupportAgent';
import { SlackChannel, ScheduledChannel } from 'toolpack-agents/channels';

const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,
});

withAgents(sdk, [
  {
    agent: CustomerSupportAgent,
    channels: [
      new SlackChannel({ channel: '#support' }),
      new ScheduledChannel({ cron: '0 9 * * *' }),
    ],
  },
]);
```

### At Runtime

```ts
await sdk.loadAgent({
  agent: CustomerSupportAgent,
  channels: [new WebhookChannel({ path: '/agent/support' })],
});
```

---

## Built-in Agents

`toolpack-agents` ships a set of ready-to-use agents. Use them directly or extend them.

| Agent | Mode | Description |
|---|---|---|
| `ResearchAgent` | `chat` | Web research, summarization, fact-finding |
| `CodingAgent` | `agent` | Code generation, refactoring, debugging |
| `DataAgent` | `agent` | Database queries, CSV analysis, reporting |
| `BrowserAgent` | `chat` | Web browsing and form interaction |

### Using a Built-in Agent

```ts
import { ResearchAgent } from 'toolpack-agents';

const agent = new ResearchAgent(sdk);
const result = await agent.invokeAgent({
  intent: 'research',
  message: 'Summarize recent developments in edge computing',
});
```

### Extending a Built-in Agent

```ts
import { ResearchAgent } from 'toolpack-agents';

export class AcmeResearchAgent extends ResearchAgent {
  systemPrompt = `You are a research agent focused only on the fintech industry...`;

  async onComplete(result: AgentResult) {
    await this.saveToDatabase(result); // add your own behavior
  }
}
```

---

## Agent Structure (Recommended)

For complex agents with sub-agents, we recommend this folder structure:

```
agents/
  CoordinatorAgent.ts     ← main agent
  sub/
    SpecialistAgentA.ts
    SpecialistAgentB.ts
channels/                 ← shared, reusable across agents
  CustomChannelA.ts
  CustomChannelB.ts
```

Channels live in their own `channels/` folder because they are reusable across agents. The agent class itself stays focused on behavior.

---

## AgentInput and AgentResult

All agents speak a common interface, which is what makes channels interoperable.

```ts
interface AgentInput {
  intent?: string;        // optional hint about what the agent should do
  message?: string;       // natural language input
  data?: unknown;         // structured payload from the channel
  context?: Record<string, unknown>; // additional context
}

interface AgentResult {
  output: string;         // the agent's response
  steps?: WorkflowStep[]; // steps taken, if workflow was used
  metadata?: Record<string, unknown>;
}
```

---

## Comparison with Modes

A common question: when should I use a **Mode** vs an **Agent**?

| | Mode | Agent |
|---|---|---|
| **Purpose** | Defines tool access and workflow config | Defines identity, behavior, and orchestration |
| **Level** | Infrastructure primitive | Application-level abstraction |
| **Reusability** | Shared across many agents | Specific to a role or use case |
| **Code** | Configuration object | Class with methods and logic |
| **Use when** | You need a custom tool/workflow profile | You need a named, deployable AI role |

An agent always sits on top of a mode. You can point multiple agents at the same mode.

---

## Roadmap

- `toolpack-agents/memory` — per-agent conversation memory and context window management
- `toolpack-agents/registry` — discover and share community agents
- Agent-to-agent messaging protocol for loosely coupled multi-agent systems
- `toolpack-agents/testing` — test utilities for unit and integration testing agents
- Additional built-in channels — Discord, WhatsApp, Email, SMS (Twilio)

---

## Installation

```bash
npm install toolpack-agents
```

Requires `toolpack-sdk` as a peer dependency.

```bash
npm install toolpack-sdk toolpack-agents
```