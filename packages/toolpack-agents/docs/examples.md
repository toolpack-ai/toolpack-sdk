# Examples — End-to-End Agent Patterns

## Contents

- [1. Single agent on Slack](#1-single-agent-on-slack)
- [2. Multi-agent system with delegation](#2-multi-agent-system-with-delegation)
- [3. Scheduled digest with Slack delivery](#3-scheduled-digest-with-slack-delivery)
- [4. Support agent with human-in-the-loop](#4-support-agent-with-human-in-the-loop)
- [5. Research + coding pipeline](#5-research--coding-pipeline)
- [6. Webhook-driven API agent](#6-webhook-driven-api-agent)
- [7. Multi-channel agent (Slack + Telegram)](#7-multi-channel-agent-slack--telegram)

---

## 1. Single agent on Slack

The simplest deployment: one agent, one channel, no registry.

```typescript
import {
  BaseAgent, AgentInput, AgentResult,
  SlackChannel,
  createEventDedupInterceptor,
  createSelfFilterInterceptor,
  createNoiseFilterInterceptor,
} from '@toolpack-sdk/agents';
import { CHAT_MODE } from 'toolpack-sdk';

class AssistantAgent extends BaseAgent {
  name = 'assistant';
  description = 'General-purpose assistant';
  mode = { ...CHAT_MODE, systemPrompt: 'You are a helpful assistant. Be concise and clear.' };

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    return this.run(input.message ?? '');
  }
}

const slack = new SlackChannel({
  name: 'main',
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: '#general',
  port: 3000,
});

const agent = new AssistantAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
agent.channels = [slack];
agent.interceptors = [
  createEventDedupInterceptor(),
  createNoiseFilterInterceptor({ denySubtypes: ['bot_message', 'message_changed'] }),
  createSelfFilterInterceptor({
    agentId: 'assistant',
    getSenderId: (input) => input.context?.userId as string,
  }),
];

await agent.start();
console.log('Assistant is listening on Slack #general');

// Graceful shutdown
process.on('SIGTERM', () => agent.stop());
```

---

## 2. Multi-agent system with delegation

An orchestrator that delegates specialised tasks to a research agent and a data agent.

```typescript
import {
  BaseAgent, AgentInput, AgentResult,
  AgentRegistry,
  ResearchAgent, DataAgent,
  SlackChannel,
  createEventDedupInterceptor,
  createSelfFilterInterceptor,
  createAddressCheckInterceptor,
} from '@toolpack-sdk/agents';

class OrchestratorAgent extends BaseAgent {
  name = 'orchestrator';
  description = 'Routes tasks to the right specialist agent';
  mode = 'chat';

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const message = input.message ?? '';

    // Classify intent
    if (/research|find|search|what is/i.test(message)) {
      const result = await this.delegateAndWait('research-agent', {
        message,
        conversationId: input.conversationId,
      });
      return result;
    }

    if (/data|analyse|report|csv|database/i.test(message)) {
      // Fire-and-forget for long-running analysis
      await this.delegate('data-agent', {
        message,
        conversationId: input.conversationId,
      });
      return { output: 'Data analysis started. I will post the results shortly.' };
    }

    return this.run(message);
  }
}

// Shared Slack channel
const slack = new SlackChannel({
  name: 'work-slack',
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: '#work',
});

const commonInterceptors = [
  createEventDedupInterceptor(),
  createSelfFilterInterceptor({
    agentId: 'orchestrator',
    getSenderId: (input) => input.context?.userId as string,
  }),
];

// Orchestrator listens on Slack
const orchestrator = new OrchestratorAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
orchestrator.channels = [slack];
orchestrator.interceptors = [
  ...commonInterceptors,
  createAddressCheckInterceptor({
    agentName: 'orchestrator',
    getMessageText: (input) => input.message ?? '',
  }),
];

// Specialist agents — no channels, invoked via delegation only
const researcher = new ResearchAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
const dataAgent = new DataAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });

const registry = new AgentRegistry([orchestrator, researcher, dataAgent]);
await registry.start();
```

---

## 3. Scheduled digest with Slack delivery

A daily digest that runs on a cron schedule and posts to Slack.

```typescript
import {
  BaseAgent, AgentInput, AgentResult,
  AgentRegistry,
  ScheduledChannel, SlackChannel,
  ResearchAgent,
} from '@toolpack-sdk/agents';
import { AGENT_MODE } from 'toolpack-sdk';

class DigestAgent extends BaseAgent {
  name = 'digest-agent';
  description = 'Generates and posts daily digests';
  mode = { ...AGENT_MODE, systemPrompt: 'You compile concise, informative daily news digests.' };

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    // Research today's top news
    const news = await this.delegateAndWait('research-agent', {
      message: 'Find the top 5 technology news stories from the past 24 hours. Be concise.',
    });

    // Format the digest
    const digest = await this.run(
      `Format this news into a clean Slack digest:\n\n${news.output}`
    );

    // Post to Slack
    await this.sendTo('digest-slack', digest.output);

    return digest;
  }
}

const scheduledChannel = new ScheduledChannel({
  name: 'daily-trigger',
  cron: '0 8 * * 1-5',                            // 8am Monday–Friday
  message: 'Generate the daily tech digest',
  notify: 'webhook:https://hooks.example.com/ack', // acknowledge trigger
});

const slackDelivery = new SlackChannel({
  name: 'digest-slack',
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: '#daily-digest',
});

const digestAgent = new DigestAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
digestAgent.channels = [scheduledChannel, slackDelivery];

const researcher = new ResearchAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });

const registry = new AgentRegistry([digestAgent, researcher]);
await registry.start();
```

---

## 4. Support agent with human-in-the-loop

A customer support agent that asks for confirmation before processing sensitive actions.

```typescript
import {
  BaseAgent, AgentInput, AgentResult,
  AgentRegistry,
  SlackChannel,
  createEventDedupInterceptor,
  createRateLimitInterceptor,
} from '@toolpack-sdk/agents';
import { CHAT_MODE } from 'toolpack-sdk';

type SupportIntent = 'refund' | 'cancel' | 'general';

class SupportAgent extends BaseAgent<SupportIntent> {
  name = 'support-agent';
  description = 'Customer support with approval workflows';
  mode = {
    ...CHAT_MODE,
    systemPrompt: 'You are a customer support agent. You help customers with orders, refunds, and issues. Always be empathetic and professional.',
  };

  async invokeAgent(input: AgentInput<SupportIntent>): Promise<AgentResult> {
    // Check for pending ask replies first
    const pending = this.getPendingAsk(input.conversationId);
    if (pending && input.message) {
      return this.handlePendingAsk(
        pending,
        input.message,
        async (orderNumber) => {
          const action = pending.context.action as string;
          if (action === 'refund') {
            // Process refund
            await this.run(`Process refund for order number: ${orderNumber}`);
            return { output: `✅ Refund for order ${orderNumber} has been submitted. You'll receive a confirmation email within 24 hours.` };
          }
          if (action === 'cancel') {
            await this.run(`Cancel order: ${orderNumber}`);
            return { output: `✅ Order ${orderNumber} has been cancelled.` };
          }
          return { output: 'Action completed.' };
        },
        async () => ({
          output: '❌ I was unable to complete the action without a valid order number. Please try again and provide your order number.',
        }),
      );
    }

    // Route by intent
    switch (input.intent) {
      case 'refund':
        return this.ask('To process your refund, I need your order number. What is it?', {
          context: { action: 'refund', requestedAt: new Date().toISOString() },
          maxRetries: 3,
          expiresIn: 30 * 60 * 1000,  // 30 minutes
        });

      case 'cancel':
        return this.ask('I can cancel that order. What is the order number you would like to cancel?', {
          context: { action: 'cancel' },
          maxRetries: 2,
        });

      default:
        return this.run(input.message ?? '');
    }
  }
}

const slack = new SlackChannel({
  name: 'support',
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: ['#support', '#customer-help'],
});

const agent = new SupportAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
agent.channels = [slack];
agent.interceptors = [
  createEventDedupInterceptor(),
  createRateLimitInterceptor({
    getKey: (input) => input.participant?.id ?? input.conversationId ?? 'global',
    tokensPerInterval: 30,
    interval: 60000,
  }),
];

const registry = new AgentRegistry([agent]);
await registry.start();
```

---

## 5. Research + coding pipeline

An agent that researches a topic, then generates code based on the findings.

```typescript
import {
  BaseAgent, AgentInput, AgentResult,
  AgentRegistry,
  ResearchAgent, CodingAgent,
  WebhookChannel,
} from '@toolpack-sdk/agents';

class ProjectAgent extends BaseAgent {
  name = 'project-agent';
  description = 'Researches topics and generates implementation code';
  mode = 'chat';

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const task = input.message ?? '';

    // Step 1: Research
    const research = await this.delegateAndWait('research-agent', {
      message: `Research best practices and common patterns for: ${task}`,
      conversationId: input.conversationId,
    });

    // Step 2: Generate implementation
    const implementation = await this.delegateAndWait('coding-agent', {
      message: `Based on this research, implement the following in TypeScript:\n\n${task}\n\nResearch context:\n${research.output}`,
      conversationId: input.conversationId,
    });

    // Step 3: Summarise
    const summary = await this.run(
      `Summarise what was built:\n\n${implementation.output}`,
      undefined,
      { conversationId: input.conversationId },
    );

    return {
      output: `## Research\n${research.output}\n\n## Implementation\n${implementation.output}\n\n## Summary\n${summary.output}`,
      metadata: {
        steps: ['research', 'implementation', 'summary'],
      },
    };
  }
}

const webhook = new WebhookChannel({
  name: 'api',
  path: '/api/project',
  port: 4000,
});

const projectAgent = new ProjectAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
projectAgent.channels = [webhook];

const researcher = new ResearchAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
const coder = new CodingAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });

const registry = new AgentRegistry([projectAgent, researcher, coder]);
await registry.start();

// POST http://localhost:4000/api/project
// { "message": "Build a simple in-memory key-value store with TTL support" }
```

---

## 6. Webhook-driven API agent

Expose an agent as a stateless HTTP API endpoint.

```typescript
import {
  BaseAgent, AgentInput, AgentResult,
  WebhookChannel,
  DataAgent,
} from '@toolpack-sdk/agents';

class APIAgent extends BaseAgent {
  name = 'api-agent';
  description = 'Processes API requests and returns structured responses';
  mode = 'agent';

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const payload = input.data as {
      action: 'query' | 'summarise' | 'analyse';
      content: string;
    };

    switch (payload?.action) {
      case 'query':
        return this.run(`Answer this query precisely: ${payload.content}`);

      case 'summarise':
        return this.run(`Summarise the following text in 3 bullet points:\n\n${payload.content}`);

      case 'analyse':
        return this.delegateAndWait('data-agent', {
          message: `Analyse this data and provide insights:\n\n${payload.content}`,
          conversationId: input.conversationId,
        });

      default:
        return this.run(input.message ?? 'Hello');
    }
  }
}

const webhook = new WebhookChannel({
  name: 'api',
  path: '/api/v1/agent',
  port: 8080,
});

const apiAgent = new APIAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
apiAgent.channels = [webhook];

const dataAgent = new DataAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
// data-agent has no channels — invoked only via delegation

await new AgentRegistry([apiAgent, dataAgent]).start();
```

Calling the API:

```bash
curl -X POST http://localhost:8080/api/v1/agent \
  -H "Content-Type: application/json" \
  -d '{ "action": "summarise", "content": "Long text to summarise..." }'
```

---

## 7. Multi-channel agent (Slack + Telegram)

One agent listening on multiple channels simultaneously.

```typescript
import {
  BaseAgent, AgentInput, AgentResult,
  SlackChannel, TelegramChannel,
  createEventDedupInterceptor,
  createSelfFilterInterceptor,
  createParticipantResolverInterceptor,
} from '@toolpack-sdk/agents';
import { CHAT_MODE } from 'toolpack-sdk';

class MultiChannelAssistant extends BaseAgent {
  name = 'multi-assistant';
  description = 'Assistant available on Slack and Telegram';
  mode = { ...CHAT_MODE, systemPrompt: 'You are a helpful assistant available across multiple platforms.' };

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    // input.participant.displayName is resolved for both Slack and Telegram
    const userName = input.participant?.displayName ?? 'there';
    const channel = input.context?.channel ?? 'unknown';

    const result = await this.run(
      input.message ?? '',
      undefined,
      { conversationId: input.conversationId },
    );

    return {
      output: result.output,
      metadata: { respondedTo: userName, via: channel },
    };
  }
}

const slack = new SlackChannel({
  name: 'slack',
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: '#general',
});

const telegram = new TelegramChannel({
  name: 'telegram',
  token: process.env.TELEGRAM_BOT_TOKEN!,
});

const agent = new MultiChannelAssistant({ apiKey: process.env.ANTHROPIC_API_KEY! });
agent.channels = [slack, telegram];
agent.interceptors = [
  createEventDedupInterceptor(),
  createSelfFilterInterceptor({
    agentId: 'multi-assistant',
    getSenderId: (input) => input.context?.userId as string,
  }),
  createParticipantResolverInterceptor(),  // resolves display names for both channels
];

// Single start() — agent listens on both platforms simultaneously
await agent.start();
console.log('Assistant listening on Slack and Telegram');
```

---

## Environment variable reference

Most examples rely on these environment variables:

```bash
# Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Discord
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_CHANNEL_ID=...

# Telegram
TELEGRAM_BOT_TOKEN=...

# Twilio SMS
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...

# Email
SMTP_HOST=smtp.example.com
SMTP_USER=agent@example.com
SMTP_PASS=...
```
