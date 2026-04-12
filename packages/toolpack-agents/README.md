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
- **Production-Ready** — 199 tests passing

## Installation

```bash
npm install @toolpack-sdk/agents
```

## Quick Start

```typescript
import { Toolpack } from 'toolpack-sdk';
import { BaseAgent, AgentRegistry, SlackChannel } from '@toolpack-sdk/agents';

// 1. Create an agent
class SupportAgent extends BaseAgent {
  name = 'support-agent';
  description = 'Customer support agent';
  mode = 'chat';

  async invokeAgent(input) {
    const result = await this.run(input.message);
    await this.sendTo('slack', result.output);
    return result;
  }
}

// 2. Set up channel
const slack = new SlackChannel({
  name: 'slack',
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  channel: '#support',
});

// 3. Register and run
const registry = new AgentRegistry([
  { agent: SupportAgent, channels: [slack] },
]);

const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,
  agents: registry,
});
```

## Built-in Agents

### ResearchAgent
Web research for summarization, fact-finding, and trend monitoring.

```typescript
import { ResearchAgent } from '@toolpack-sdk/agents';

const agent = new ResearchAgent(sdk);
const result = await agent.invokeAgent({
  message: 'Summarize recent AI developments',
});
```

**Mode:** `agent` | **Tools:** `web.search`, `web.fetch`, `web.scrape`

### CodingAgent
Code generation, refactoring, debugging, and test writing.

```typescript
import { CodingAgent } from '@toolpack-sdk/agents';

const agent = new CodingAgent(sdk);
const result = await agent.invokeAgent({
  message: 'Refactor the auth module',
});
```

**Mode:** `coding` | **Tools:** `fs.*`, `coding.*`, `git.*`, `exec.*`

### DataAgent
Database queries, reporting, data analysis, and CSV generation.

```typescript
import { DataAgent } from '@toolpack-sdk/agents';

const agent = new DataAgent(sdk);
const result = await agent.invokeAgent({
  message: 'Generate weekly signups report',
});
```

**Mode:** `agent` | **Tools:** `db.*`, `fs.*`, `http.*`

### BrowserAgent
Web browsing, form interaction, and content extraction.

```typescript
import { BrowserAgent } from '@toolpack-sdk/agents';

const agent = new BrowserAgent(sdk);
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
  notify: 'slack:#reports',
  message: 'Generate daily report',
});
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

## Knowledge Integration

Integrate knowledge bases for conversation memory and RAG:

```typescript
import { Knowledge, MemoryProvider } from '@toolpack-sdk/knowledge';

class SmartAgent extends BaseAgent {
  knowledge = await Knowledge.create({
    provider: new MemoryProvider(),
  });

  async invokeAgent(input) {
    // Knowledge is automatically available as knowledge_search tool
    const result = await this.run(input.message);
    return result;
  }
}
```

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
    // Store in knowledge base
    if (this.knowledge) {
      await this.knowledge.add(result.output, { category: 'fintech' });
    }
    
    // Notify team
    await this.sendTo('slack-research', result.output);
  }
}
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
  constructor(registrations: AgentRegistration[]);
  start(toolpack: Toolpack): void;
  stop(): Promise<void>;
  sendTo(channelName: string, output: AgentOutput): Promise<void>;
  getAgent(name: string): AgentInstance | undefined;
  getChannel(name: string): ChannelInterface | undefined;
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

## Testing

```bash
npm test
```

**Test Coverage:** 199 tests passing across 15 test files.

## License

Apache 2.0 © Toolpack SDK
