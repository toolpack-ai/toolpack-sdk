# @toolpack-sdk/agents

Build production-ready AI agents with channels, workflows, and event-driven architecture.

[![npm version](https://img.shields.io/npm/v/@toolpack-sdk/agents.svg)](https://www.npmjs.com/package/@toolpack-sdk/agents)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Features

- **4 Built-in Agents** — Research, Coding, Data, Browser
- **7 Channel Types** — Slack, Telegram, Discord, Email, SMS, Webhook, Scheduled
- **Event-Driven** — Full lifecycle hooks and events
- **Human-in-the-Loop** — `ask()` support for two-way channels
- **Knowledge Integration** — Built-in RAG support with knowledge bases
- **Type-Safe** — Full TypeScript support
- **Production-Ready** — 285 tests passing

## Installation

```bash
npm install @toolpack-sdk/agents
```

## Stable API (Phase 4)

The following APIs are stable and follow semantic versioning. Breaking changes will require a major version bump:

- `BaseAgent` — Abstract base class for all agents
- `BaseChannel` — Abstract base class for all channels
- `AgentRegistry` — Registry for agents and channels
- `AgentInput`, `AgentResult`, `AgentOutput` — Core data structures
- `AgentTransport`, `LocalTransport`, `JsonRpcTransport` — Transport layer
- `AgentJsonRpcServer` — JSON-RPC server for hosting agents
- `AgentError` — Error class for agent failures

### Version Policy

- **Major (X.y.z)** — Breaking API changes
- **Minor (x.Y.z)** — New features, backward compatible
- **Patch (x.y.Z)** — Bug fixes, backward compatible

## Quick Start

```typescript
import { BaseAgent, AgentRegistry, SlackChannel } from '@toolpack-sdk/agents';

// 1. Create a channel
const slack = new SlackChannel({
  name: 'slack',
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  channel: '#support',
});

// 2. Create an agent (channels live on the agent)
class SupportAgent extends BaseAgent {
  name = 'support-agent';
  description = 'Customer support agent';
  mode = 'chat';
  channels = [slack];

  async invokeAgent(input) {
    const result = await this.run(input.message);
    return result;
  }
}

// 3. Single-agent: start directly
const agent = new SupportAgent({ apiKey: process.env.ANTHROPIC_API_KEY });
await agent.start();

// OR multi-agent: use AgentRegistry
// const registry = new AgentRegistry([agent]);
// await registry.start();
```

## Built-in Agents

### ResearchAgent
Web research for summarization, fact-finding, and trend monitoring.

```typescript
import { ResearchAgent } from '@toolpack-sdk/agents';

const agent = new ResearchAgent({ apiKey: process.env.ANTHROPIC_API_KEY });
const result = await agent.invokeAgent({
  message: 'Summarize recent AI developments',
});
```

**Mode:** `agent` | **Tools:** `web.search`, `web.fetch`, `web.scrape`

### CodingAgent
Code generation, refactoring, debugging, and test writing.

```typescript
import { CodingAgent } from '@toolpack-sdk/agents';

const agent = new CodingAgent({ apiKey: process.env.ANTHROPIC_API_KEY });
const result = await agent.invokeAgent({
  message: 'Refactor the auth module',
});
```

**Mode:** `coding` | **Tools:** `fs.*`, `coding.*`, `git.*`, `exec.*`

### DataAgent
Database queries, reporting, data analysis, and CSV generation.

```typescript
import { DataAgent } from '@toolpack-sdk/agents';

const agent = new DataAgent({ apiKey: process.env.ANTHROPIC_API_KEY });
const result = await agent.invokeAgent({
  message: 'Generate weekly signups report',
});
```

**Mode:** `agent` | **Tools:** `db.*`, `fs.*`, `http.*`

### BrowserAgent
Web browsing, form interaction, and content extraction.

```typescript
import { BrowserAgent } from '@toolpack-sdk/agents';

const agent = new BrowserAgent({ apiKey: process.env.ANTHROPIC_API_KEY });
const result = await agent.invokeAgent({
  message: 'Extract prices from acme.com/products',
});
```

**Mode:** `chat` | **Tools:** `web.fetch`, `web.screenshot`, `web.extract_links`

## Channels

Channels connect agents to external services. They can be **two-way** (receive messages, support `ask()`) or **trigger-only** (send only, no `ask()` support).

### SlackChannel (Two-way)

```typescript
const slack = new SlackChannel({
  name: 'slack-support',
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  channel: '#support',
  port: 3000,
});
```

### TelegramChannel (Two-way)

```typescript
const telegram = new TelegramChannel({
  name: 'telegram-bot',
  token: process.env.TELEGRAM_BOT_TOKEN,
});
```

### WebhookChannel (Two-way)

```typescript
const webhook = new WebhookChannel({
  name: 'github-webhook',
  path: '/webhook/github',
  port: 3000,
});
```

### ScheduledChannel (Trigger-only)

Runs agents on cron schedules. Supports full cron expressions.

```typescript
const scheduler = new ScheduledChannel({
  name: 'daily-report',
  cron: '0 9 * * 1-5', // 9am weekdays
  notify: 'webhook:https://hooks.example.com/daily-report',
  message: 'Generate daily report',
});
// For Slack delivery, attach a named SlackChannel to the same agent and
// call `this.sendTo('<slackChannelName>', output)` from within `run()`.
```

### DiscordChannel (Two-way)

```typescript
const discord = new DiscordChannel({
  name: 'discord-bot',
  token: process.env.DISCORD_BOT_TOKEN,
  guildId: 'your-guild-id',
  channelId: 'your-channel-id',
});
```

### EmailChannel (Outbound-only)

```typescript
const email = new EmailChannel({
  name: 'email-alerts',
  from: 'bot@acme.com',
  to: 'team@acme.com',
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    auth: { user: 'bot@acme.com', pass: process.env.SMTP_PASSWORD },
  },
});
```

### SMSChannel (Configurable)

Two-way when `webhookPath` is set, outbound-only otherwise.

```typescript
// Two-way
const sms = new SMSChannel({
  name: 'sms-alerts',
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  from: '+1234567890',
  webhookPath: '/sms/webhook',
  port: 3000,
});

// Outbound-only
const smsOutbound = new SMSChannel({
  name: 'sms-notifications',
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  from: '+1234567890',
  to: '+0987654321',
});
```

## Creating Custom Agents

Extend `BaseAgent` to create custom agents:

```typescript
import { BaseAgent } from '@toolpack-sdk/agents';

class MyAgent extends BaseAgent {
  name = 'my-agent';
  description = 'My custom agent';
  mode = 'agent';

  async invokeAgent(input) {
    // Process the message
    const result = await this.run(input.message);
    
    // Send to a channel
    await this.sendTo('slack', result.output);
    
    return result;
  }
}
```

## Human-in-the-Loop

Use `ask()` to pause execution and wait for human input (two-way channels only):

```typescript
class ApprovalAgent extends BaseAgent {
  name = 'approval-agent';
  mode = 'agent';

  async invokeAgent(input) {
    // Do some work
    const draft = await this.generateDraft(input.message);
    
    // Ask for approval
    const approval = await this.ask('Approve this draft? (yes/no)');
    
    if (approval.answer === 'yes') {
      await this.sendTo('slack', 'Draft approved!');
    }
    
    return { output: draft };
  }
}
```

**Note:** `ask()` throws an error if called from trigger-only channels (ScheduledChannel, EmailChannel).

## Conversation History

Store conversation history separately from domain knowledge:

```typescript
import { InMemoryConversationStore } from '@toolpack-sdk/agents';

class SupportAgent extends BaseAgent {
  // In-memory store (development/single-process)
  conversationHistory = new InMemoryConversationStore();

  async invokeAgent(input) {
    // History is automatically loaded before AI call
    // and stored after response
    const result = await this.run(input.message);
    return result;
  }
}
```

**Features:**
- Auto-loads last 10 messages before each AI call
- Auto-stores user and assistant messages
- Auto-trims to `maxMessages` limit (default: 20)
- Zero-config in-memory mode for development
- Optional SQLite persistence for production
- `conversation_search` tool is automatically provided as a request-scoped tool when search is enabled

**Memory model:**
Agent memory is per-conversation by default. The `conversation_search` tool is bound at invocation time to the current conversation — the LLM cannot override this scope, and turns from other conversations are structurally unreachable. Use `knowledge_add` to promote durable facts that should persist across conversations; knowledge is the only cross-conversation bridge.

## Knowledge Integration

Integrate knowledge bases for RAG (domain knowledge, not conversation history).
Knowledge is configured at the SDK level and automatically available to all agents:

```typescript
import { Toolpack } from 'toolpack-sdk';
import { Knowledge, MemoryProvider } from '@toolpack-sdk/knowledge';

// Configure knowledge at SDK level
const knowledge = await Knowledge.create({
  provider: new MemoryProvider(),
});

const toolpack = await Toolpack.init({
  provider: 'openai',
  knowledge, // Available to all agents using this toolpack
});

class SmartAgent extends BaseAgent {
  async invokeAgent(input) {
    // Both `knowledge_search` and `knowledge_add` tools are
    // automatically available as request-scoped tools.
    // The AI can use them to retrieve or store information.
    const result = await this.run(input.message);
    return result;
  }
}
```

**Available Tools:**
- `knowledge_search` — Search the knowledge base for relevant information
- `knowledge_add` — Add new information to the knowledge base at runtime

The SDK automatically injects usage guidance into the system prompt when these tools are available.

**Knowledge as the cross-conversation bridge:**

`knowledge_add` is the *only* path by which information crosses conversation boundaries. Conversation history is scoped to the current conversation and inaccessible elsewhere; anything promoted via `knowledge_add` becomes available in all future conversations for that agent.

Promote when:
- A task surfaces a fact useful beyond the current conversation
- A user states a durable preference
- A decision is made that future conversations should respect

Do **not** promote:
- Routine task outputs (e.g., "answered a weather question")
- Context that is specific to this conversation only
- Confidential information whose visibility should remain inside the current conversation

Because every promotion is an explicit agent action visible in traces, the knowledge base stays auditable and intentional. If you need per-entry visibility controls (e.g., scoping a knowledge entry to a subset of channels), that is a future extension — for now, apply developer discipline: only promote what every future conversation is permitted to see.

## Multi-Channel Routing

Send output to multiple channels:

```typescript
class MultiChannelAgent extends BaseAgent {
  async invokeAgent(input) {
    const result = await this.run(input.message);
    
    await this.sendTo('slack', result.output);
    await this.sendTo('email-team', result.output);
    await this.sendTo('sms-alerts', 'Task done!');
    
    return result;
  }
}
```

## Agent Events

Listen to agent lifecycle events:

```typescript
const agent = new MyAgent(sdk);

agent.on('agent:start', (input) => {
  console.log('Agent started:', input.message);
});

agent.on('agent:complete', (result) => {
  console.log('Agent completed:', result.output);
});

agent.on('agent:error', (error) => {
  console.error('Agent error:', error);
});
```

## Extending Built-in Agents

Customize built-in agents with your own prompts and logic:

```typescript
import { ResearchAgent } from '@toolpack-sdk/agents';

class FintechResearchAgent extends ResearchAgent {
  systemPrompt = `You are a fintech research specialist.
                  Always cite sources and flag regulatory implications.`;

  async onComplete(result) {
    // Notify team
    await this.sendTo('slack-research', result.output);
  }
}

// Knowledge is configured at SDK level, not on the agent.
// The AI can use `knowledge_add` to store information during execution.
const toolpack = await Toolpack.init({
  provider: 'openai',
  knowledge: await Knowledge.create({ provider: new MemoryProvider() }),
});
```

## Peer Dependencies

The following are optional peer dependencies. Install only what you need:

```bash
# For DiscordChannel
npm install discord.js

# For EmailChannel  
npm install nodemailer

# For SMSChannel
npm install twilio
```

## API Reference

### BaseAgent

```typescript
abstract class BaseAgent {
  abstract name: string;
  abstract description: string;
  abstract mode: string;
  
  // Core method to implement
  abstract invokeAgent(input: AgentInput): Promise<AgentResult>;
  
  // Built-in methods
  protected run(message: string): Promise<AgentResult>;
  protected sendTo(channelName: string, message: string): Promise<void>;
  protected ask(question: string, options?: AskOptions): Promise<AgentResult>;
  protected getPendingAsk(): PendingAsk | null;
}
```

### AgentRegistry

```typescript
class AgentRegistry {
  constructor(agents: BaseAgent[]);
  start(): Promise<void>;
  stop(): Promise<void>;
  sendTo(channelName: string, output: AgentOutput): Promise<void>;
  getAgent(name: string): AgentInstance | undefined;
  getChannel(name: string): ChannelInterface | undefined;
  invoke(agentName: string, input: AgentInput): Promise<AgentResult>;
}
```

### Channels

All channels extend `BaseChannel`:

```typescript
abstract class BaseChannel {
  abstract readonly isTriggerChannel: boolean;
  name?: string;
  
  abstract listen(): void;
  abstract send(output: AgentOutput): Promise<void>;
  abstract stop(): Promise<void>;
  onMessage(handler: (input: AgentInput) => Promise<void>): void;
}
```

## Agent-to-Agent Messaging

Agents can delegate tasks to other agents without tight coupling.

### Local Delegation (Same Process)

```typescript
import { AgentRegistry, BaseAgent } from '@toolpack-sdk/agents';
import type { AgentInput, AgentResult } from '@toolpack-sdk/agents';

class EmailAgent extends BaseAgent {
  name = 'email-agent';
  description = 'Sends email reports';
  mode = 'chat';
  channels = [slack]; // channels are class properties, not constructor args

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    // Delegate to DataAgent and wait for result
    const report = await this.delegateAndWait('data-agent', {
      message: 'Generate weekly leads report',
      intent: 'generate_report',
    });
    
    return {
      output: `Email sent with report: ${report.output}`,
    };
  }
}

const emailAgent = new EmailAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
const dataAgent = new DataAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
const registry = new AgentRegistry([emailAgent, dataAgent]);
await registry.start();
```

### Cross-Process Delegation (JSON-RPC)

**Server (Host Agents):**
```typescript
import { AgentJsonRpcServer } from '@toolpack-sdk/agents';

const server = new AgentJsonRpcServer({ port: 3000 });
server.registerAgent('data-agent', new DataAgent({ apiKey: process.env.ANTHROPIC_API_KEY! }));
server.registerAgent('research-agent', new ResearchAgent({ apiKey: process.env.ANTHROPIC_API_KEY! }));
server.listen();
```

**Client (Call Remote Agents):**
```typescript
import { AgentRegistry, JsonRpcTransport, BaseAgent } from '@toolpack-sdk/agents';
import type { AgentInput, AgentResult } from '@toolpack-sdk/agents';

const emailAgent = new EmailAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
const registry = new AgentRegistry([emailAgent], {
  transport: new JsonRpcTransport({
    agents: {
      'data-agent': 'http://localhost:3000',
      'research-agent': 'http://remote-server:3000',
    }
  })
});

// Inside EmailAgent
class EmailAgent extends BaseAgent {
  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    // Can now delegate to remote agents
    const report = await this.delegateAndWait('data-agent', {
      message: 'Generate report'
    });
    return { output: `Email sent with: ${report.output}` };
  }
}
```

### Delegation Methods

- **`delegate(agentName, input)`** - Fire-and-forget, returns immediately
- **`delegateAndWait(agentName, input)`** - Waits for result, returns `AgentResult`

## Registry

Discover and publish community-built agents.

### Finding Agents

```typescript
import { searchRegistry } from '@toolpack-sdk/agents/registry';

// Search all agents
const results = await searchRegistry();

// Search by keyword
const results = await searchRegistry({ keyword: 'fintech' });

// Filter by category
const results = await searchRegistry({ category: 'research' });

// Display results
for (const agent of results.agents) {
  console.log(`${agent.name}: ${agent.toolpack?.description || agent.description}`);
  console.log(`  Install: npm install ${agent.name}`);
}
```

### Publishing an Agent

Add the `toolpack` metadata to your `package.json`:

```json
{
  "name": "toolpack-agent-fintech-research",
  "version": "1.0.0",
  "keywords": ["toolpack-agent"],
  "toolpack": {
    "agent": true,
    "category": "research",
    "description": "Research agent focused on fintech news and regulatory updates",
    "tags": ["fintech", "news", "research"]
  }
}
```

Requirements:
- Must include `"toolpack-agent"` in `keywords`
- Must have `"toolpack": { "agent": true }` in package.json
- Agent class must extend `BaseAgent`

## Error Handling

### Error Types

| Error | Cause | Resolution |
|-------|-------|------------|
| `AgentError` | Generic agent failure | Check error message for details |
| `AgentError` (delegate) | Agent not registered | Ensure agent is registered with `AgentRegistry` |
| `AgentError` (transport) | Transport misconfiguration | Verify transport config and agent URLs |
| `RegistryError` | NPM registry failure | Check network connection and registry URL |

### Handling Errors

```typescript
import { AgentError } from '@toolpack-sdk/agents';

try {
  const result = await agent.invokeAgent({ message: 'Hello' });
} catch (error) {
  if (error instanceof AgentError) {
    // Agent-specific error
    console.error('Agent failed:', error.message);
  } else {
    // Unknown error
    console.error('Unexpected error:', error);
  }
}
```

### Common Issues

**Agent not found during delegation**
```
Agent "data-agent" not found in registry. Available agents: email-agent, browser-agent
```
→ Ensure the target agent is registered in `AgentRegistry`.

**Transport configuration error**
```
No transport configured for delegation
```
→ Use `AgentRegistry` with `LocalTransport` (default) or configure `JsonRpcTransport` for cross-process communication.

**JSON-RPC connection failure**
```
Failed to invoke agent "data-agent" at http://localhost:3000: fetch failed
```
→ Verify the JSON-RPC server is running and the URL/port is correct.

## Testing

```bash
npm test
```

**Test Coverage:** 285 tests passing across 19 test files.

## License

Apache 2.0 © Toolpack SDK
