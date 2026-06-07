# Channels — Connecting Agents to External Systems

Channels normalise incoming events into `AgentInput` and deliver `AgentOutput` back to the external system. Each channel implements the `ChannelInterface`.

## Contents

- [ChannelInterface](#channelinterface)
- [Trigger vs. conversation channels](#trigger-vs-conversation-channels)
- [SlackChannel](#slackchannel)
- [DiscordChannel](#discordchannel)
- [TelegramChannel](#telegramchannel)
- [WebhookChannel](#webhookchannel)
- [ScheduledChannel](#scheduledchannel)
- [EmailChannel](#emailchannel)
- [SMSChannel](#smschannel)
- [Custom channels](#custom-channels)

---

## ChannelInterface

```typescript
interface ChannelInterface {
  name?: string;                        // required for sendTo() routing
  isTriggerChannel: boolean;            // see below

  listen(): void;                       // start accepting messages
  send(output: AgentOutput): Promise<void>;
  normalize(incoming: unknown): AgentInput;
  onMessage(handler: (input: AgentInput) => Promise<void>): void;

  // Optional: resolve richer Participant info (display name, etc.)
  resolveParticipant?(input: AgentInput): Promise<Participant | undefined> | Participant | undefined;
}
```

You do not normally call these methods yourself — `BaseAgent._bindChannel()` and `AgentRegistry` manage the lifecycle.

---

## Trigger vs. conversation channels

| `isTriggerChannel` | Examples | Can use `ask()`? | Has human recipient? |
|---|---|---|---|
| `false` | Slack, Discord, Telegram, Webhook | Yes | Yes |
| `true` | Scheduled, Email, SMS (outbound) | **No** | No |

**Trigger channels** fire the agent on a schedule or external event but have no interactive human on the other end. Calling `ask()` from a trigger channel throws:

```
AgentError: this.ask() called from a trigger channel (ScheduledChannel).
Trigger channels have no human recipient — use a conversation channel instead.
```

---

## SlackChannel

Connects your agent to Slack workspaces via the Events API.

### Install

```bash
npm install @slack/web-api
```

### Configuration

```typescript
import { SlackChannel } from '@toolpack-sdk/agents';

const slack = new SlackChannel({
  name: 'support-slack',             // required for sendTo() routing
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,

  // Listen on one channel, multiple channels, or omit to listen to all
  channel: '#support',                         // single channel (or pass channel ID 'C12345')
  // channel: ['#support', '#escalations'],    // multiple channels
  // channel: null,                            // listen to every channel the bot is in

  port: 3000,                                  // port for Slack events webhook (default: 3000)

  // Optional allow/block lists for bot users (matched against bot_id B... or user id U...)
  allowedBotIds: ['U123ABC'],
  blockedBotIds: ['U456DEF'],
});
```

### What it does

- Starts a plain HTTP server to receive Slack Events API callbacks (built-in, no `@slack/bolt` dependency).
- On startup, runs `auth.test` to determine `botUserId`. This ID is added as an agent alias so `assemblePrompt` can recognise messages addressed to the bot even when mentioned by its platform ID.
- Caches `resolveParticipant()` results and invalidates on `user_change` events.
- Supports thread replies — messages in threads use the thread timestamp as `conversationId`.

### Slack app setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable **Event Subscriptions** → set Request URL to `https://<your-host>/slack/events`
3. Subscribe to bot events: `message.channels`, `message.groups`, `app_mention`
4. Install the app to your workspace
5. Copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
6. Copy **Signing Secret** → `SLACK_SIGNING_SECRET`

---

## DiscordChannel

Connects your agent to Discord servers via the Gateway (WebSocket) API.

### Install

```bash
npm install discord.js
```

### Configuration

```typescript
import { DiscordChannel } from '@toolpack-sdk/agents';

const discord = new DiscordChannel({
  name: 'discord',
  token: process.env.DISCORD_BOT_TOKEN!,
  guildId: process.env.DISCORD_GUILD_ID!,
  channelId: process.env.DISCORD_CHANNEL_ID!,
});
```

### What it does

- Uses `discord.js` client with `GatewayIntentBits.Guilds`, `GuildMessages`, `MessageContent`, and `DirectMessages`.
- Normalises Discord messages → `AgentInput` with thread support.
- Sends responses back to the originating channel.

### Discord bot setup

1. Create an application at https://discord.com/developers/applications
2. Under **Bot**, generate a token → `DISCORD_BOT_TOKEN`
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. Invite the bot to your server with `bot` + `applications.commands` scopes and `Send Messages` permission
5. Copy the **Server ID** → `DISCORD_GUILD_ID` (right-click server → Copy ID with Developer Mode on)
6. Copy the **Channel ID** → `DISCORD_CHANNEL_ID`

---

## TelegramChannel

Connects your agent to Telegram via bot polling or webhooks.

### Install

```bash
npm install node-telegram-bot-api
```

### Configuration

```typescript
import { TelegramChannel } from '@toolpack-sdk/agents';

const telegram = new TelegramChannel({
  name: 'telegram',
  token: process.env.TELEGRAM_BOT_TOKEN!,

  // Optional: use webhook instead of polling
  // webhookUrl: 'https://your-server.com/telegram/webhook',
});
```

### What it does

- On startup, calls `getMe` to populate `botUserId` and `botUsername`.
- Supports both polling (development) and webhook (production) modes.
- Sends text messages via the Telegram Bot API.

### Telegram bot setup

1. Message `@BotFather` on Telegram
2. Run `/newbot` and follow the prompts
3. Copy the token → `TELEGRAM_BOT_TOKEN`

---

## WebhookChannel

Exposes an HTTP endpoint. Any HTTP POST to the endpoint triggers the agent.

### Configuration

```typescript
import { WebhookChannel } from '@toolpack-sdk/agents';

const webhook = new WebhookChannel({
  name: 'api-webhook',
  path: '/api/agent',          // HTTP path
  port: 4000,                  // HTTP port (default: 3000)
});
```

### Request format

Send a POST request with JSON body:

```json
{
  "message": "Summarise the quarterly report",
  "conversationId": "session-abc",
  "context": { "userId": "user-123" }
}
```

The channel responds synchronously — the HTTP response body is the agent's output.

### Response format

```json
{
  "output": "The quarterly report shows...",
  "metadata": { "conversationId": "session-abc" }
}
```

---

## ScheduledChannel

Triggers an agent on a cron schedule. Three modes are available:

| Mode | Config | When to use |
|---|---|---|
| Static | `cron` only | Fixed schedule, no persistence needed |
| Dynamic | `store` only | Agent drives its own schedule via `scheduler.*` tools |
| Hybrid | `cron` + `store` | Fixed seed + agent-driven additions |

### Install (store and hybrid modes)

```bash
npm install better-sqlite3
```

### Static mode

```typescript
import { ScheduledChannel } from '@toolpack-sdk/agents';

const daily = new ScheduledChannel({
  name: 'daily-report',
  cron: '0 9 * * 1-5',     // 9am Monday–Friday
  intent: 'daily_summary',
  message: 'Generate the daily standup summary',
});
```

The cron expression is validated on construction — an invalid expression throws immediately. Supported syntax:

- **5-field** `min hour dom month dow` and **6-field** `sec min hour dom month dow`
- Step (`*/15`), range (`9-17`), list (`1,3,5`), combined (`*/15 9-17 * * 1-5`)
- Named days (`MON-FRI`, case-insensitive) and months (`JAN-DEC`)
- Modifiers: `L` (last day/weekday of month), `#` (nth weekday — e.g. `5#2` = second Friday)
- Macros: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@hourly`, `@minutely`

### Dynamic store mode

Let the agent schedule its own future invocations. Requires `better-sqlite3`.

```typescript
import {
  ScheduledChannel,
  SchedulerStore,
  createSchedulerTools,
} from '@toolpack-sdk/agents';

const store = new SchedulerStore({ dbPath: './scheduler.db' });

const channel = new ScheduledChannel({
  name: 'dynamic',
  store,
  idlePollMs: 10_000,  // poll interval when store is empty (default: 30_000, min: 1000)
});

// Expose scheduler tools so the LLM can manage its own schedule
const toolpack = await Toolpack.init({
  provider: 'anthropic',
  customTools: [createSchedulerTools(store)],
});
```

The agent can then call four scheduler tools:

| Tool | Description |
|---|---|
| `scheduler.create` | Schedule a recurring (`cron`) or one-shot (`run_at`) job |
| `scheduler.list` | List pending / all jobs |
| `scheduler.cancel` | Cancel a pending job by ID |
| `scheduler.update` | Change the cron, run time, message, intent, or payload of a pending job |

See [scheduler.md](scheduler.md) for the full `SchedulerStore` and tool reference.

### Hybrid mode

Seed a static cron job into the store and let the agent add more:

```typescript
const store = new SchedulerStore({ dbPath: './scheduler.db' });

const channel = new ScheduledChannel({
  name: 'hybrid',
  cron: '0 9 * * 1-5',   // seeded into store on first listen()
  store,
  intent: 'morning_check',
  idlePollMs: 10_000,
});
```

The static `cron` is inserted as a recurring job on startup. Deduplication prevents re-insertion on restarts; the agent can schedule additional jobs using `scheduler.create`.

### Routing output

`ScheduledChannel` is a **pure trigger** — it has no `send()` behaviour. Route output by attaching a named channel and calling `sendTo()` from `invokeAgent()`:

```typescript
class DigestAgent extends BaseAgent {
  name = 'digest';
  mode = 'agent';
  channels = [
    new ScheduledChannel({ name: 'daily', cron: '0 9 * * 1-5' }),
    new SlackChannel({ name: 'team-slack', channel: '#standups', token, signingSecret }),
  ];

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const report = await this.run(input.message ?? '');
    await this.sendTo('team-slack', report.output);
    return report;
  }
}
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Channel name for `sendTo()` routing. Required in store/hybrid mode. |
| `cron` | `string` | — | Cron expression (5- or 6-field). Required in static/hybrid mode. |
| `store` | `SchedulerStore` | — | SQLite-backed job store. Required in dynamic/hybrid mode. |
| `intent` | `string` | — | Default intent forwarded to `AgentInput.intent`. |
| `message` | `string` | — | Default message forwarded to `AgentInput.message`. |
| `idlePollMs` | `number` | `30_000` | How often (ms) to poll the store when no jobs are pending. Min: 1000. |

### Startup behaviour (store and hybrid modes)

On first `listen()` (process startup):

1. **Crash recovery** — resets any `running` jobs left over from a previous crash back to `pending`
2. **Cron seeding** — inserts the static `cron` job if provided (idempotent via dedup)
3. **Missed-run recovery** — immediately executes any overdue pending jobs

On a `stop()+listen()` cycle within the same process, crash recovery is skipped to avoid interfering with in-flight jobs from the previous cycle.

### `isTriggerChannel`

`ScheduledChannel.isTriggerChannel` is `true`. Calling `ask()` from within a scheduled run throws — there is no human to answer.

---

## EmailChannel

Outbound-only email delivery.

### Install

```bash
npm install nodemailer
```

### Configuration

```typescript
import { EmailChannel } from '@toolpack-sdk/agents';

const email = new EmailChannel({
  name: 'email-alerts',
  from: 'agent@example.com',
  to: 'team@example.com',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  },
});
```

`isTriggerChannel = true`. Use this for sending outbound email notifications from your agent.

For inbound email, set up an email parsing service and deliver the payload to a `WebhookChannel`.

---

## SMSChannel

Bidirectional SMS via Twilio.

### Install

```bash
npm install twilio
```

### Configuration

```typescript
import { SMSChannel } from '@toolpack-sdk/agents';

const sms = new SMSChannel({
  name: 'sms',
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  from: process.env.TWILIO_FROM_NUMBER!,

  // Optional: recipient number for outbound-only SMS
  // to: '+15551234567',

  // Optional: HTTP path to receive inbound SMS (makes channel bidirectional)
  // webhookPath: '/sms/webhook',
  // port: 3000,  // default: 3000
});
```

`isTriggerChannel` is **dynamic**: `true` when `webhookPath` is not set (outbound-only), `false` when `webhookPath` is set (bidirectional). Sends SMS via the Twilio REST API.

---

## McpChannel

`McpChannel` exposes a Toolpack agent as a tool in an MCP server. When an MCP client calls `agent.<name>`, the channel delivers the input to the agent and returns its output as the tool result.

`isTriggerChannel = false` — the MCP client drives the conversation, so `ask()` works normally.

### Configuration

```typescript
import { McpChannel } from '@toolpack-sdk/agents';

const ch = new McpChannel({
  // Optional: descriptive name used for sendTo() routing
  name: 'mcp',
});
```

### Wiring to an agent and MCP server

```typescript
import { McpChannel } from '@toolpack-sdk/agents';
import { Toolpack } from 'toolpack-sdk';

const ch = new McpChannel();
const agent = new PrReviewerAgent({ channels: [ch] });
await agent.start();

const sdk = await Toolpack.init({ provider: 'anthropic', tools: true });

await sdk.startMcpServer({
  transport: 'stdio',     // or 'http'
  agents: [ch.asAgentDefinition(agent)],
});
```

`ch.asAgentDefinition(agent)` produces the `McpAgentDefinition` object that `startMcpServer` uses to register the agent in `tools/list` as `agent.<agentName>`.

### `McpChannelConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | `'mcp'` | Channel name for `sendTo()` routing. |

### Flow

1. MCP client calls `tools/call` with `name: 'agent.<agentName>'`
2. `startMcpServer` routes the call to `ch.asAgentDefinition(agent).invoke(args)`
3. `McpChannel` wraps args into an `AgentInput` and calls `agent.invokeAgent()`
4. Agent runs, returns `AgentResult`
5. Output is returned to the MCP client as a text tool result

---

## Custom channels

Implement `ChannelInterface` (or extend `BaseChannel`) to connect any data source:

```typescript
import { BaseChannel, AgentInput, AgentOutput } from '@toolpack-sdk/agents';

class KafkaChannel extends BaseChannel {
  readonly isTriggerChannel = false;

  constructor(private config: { topic: string; brokers: string[] }) {
    super();
    this.name = 'kafka';
  }

  listen(): void {
    // Subscribe to Kafka topic, call this._messageHandler(this.normalize(msg))
  }

  async send(output: AgentOutput): Promise<void> {
    // Produce to Kafka response topic
  }

  normalize(incoming: unknown): AgentInput {
    const msg = incoming as KafkaMessage;
    return {
      message: msg.value.toString(),
      conversationId: msg.key?.toString() ?? `kafka-${Date.now()}`,
      participant: { kind: 'user', id: msg.headers?.userId ?? 'unknown' },
    };
  }
}
```

`BaseChannel` provides the `onMessage()` registration and `_messageHandler` field — call `this._messageHandler(input)` when a message arrives.
