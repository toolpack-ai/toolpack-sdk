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

Triggers an agent on a cron schedule.

### Configuration

```typescript
import { ScheduledChannel } from '@toolpack-sdk/agents';

const daily = new ScheduledChannel({
  name: 'daily-report',
  cron: '0 9 * * 1-5',           // 9am Monday–Friday
  message: 'Generate the daily standup summary',
  intent: 'daily_summary',        // optional intent hint
  notify: 'webhook:https://hooks.example.com/daily',
});
```

`cron` accepts standard 5-field cron syntax. The expression is validated on construction — an invalid expression throws immediately.

### `notify` targets

| Prefix | Behaviour |
|---|---|
| `webhook:<url>` | POSTs `{ output, metadata, timestamp }` as JSON to the URL |

For routing output to a Slack or other channel, attach both channels to the same agent and use `sendTo()` from `invokeAgent()`:

```typescript
agent.channels = [
  new ScheduledChannel({ name: 'daily', cron: '0 9 * * 1-5', notify: 'webhook:...' }),
  new SlackChannel({ name: 'team-slack', channel: '#standups', token, signingSecret }),
];

async invokeAgent(input: AgentInput): Promise<AgentResult> {
  const report = await this.buildReport();
  await this.sendTo('team-slack', report);   // route to Slack
  return { output: report };
}
```

This keeps all Slack credentials and thread routing in `SlackChannel` rather than duplicated inside `ScheduledChannel`.

### isTriggerChannel

`ScheduledChannel.isTriggerChannel` is `true`. Calling `ask()` from within a scheduled invocation throws because there is no human to answer.

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
