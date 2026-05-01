# Conversation History

`toolpack-agents` provides a built-in conversation history system. Every agent gets an `InMemoryConversationStore` by default. History is written automatically by the capture interceptor and read by `assemblePrompt()` before each LLM call.

## Contents

- [How history flows](#how-history-flows)
- [ConversationStore interface](#conversationstore-interface)
- [InMemoryConversationStore](#inmemoryconversationstore)
- [StoredMessage shape](#storedmessage-shape)
- [assemblePrompt()](#assembleprompt)
- [AssemblerOptions reference](#assembleroptions-reference)
- [Addressed-only mode](#addressed-only-mode)
- [Rolling summarisation](#rolling-summarisation)
- [conversation_search tool](#conversation_search-tool)
- [Replacing with a persistent store](#replacing-with-a-persistent-store)

---

## How history flows

```
Inbound message (from channel)
        │
        ▼
  CaptureInterceptor  ────────────────► ConversationStore.append()
  (auto-prepended)                      (inbound turn recorded)
        │
        ▼
  invokeAgent() → run()
        │
        ├── assemblePrompt() ──────────► ConversationStore.get()
        │   (builds LLM context)         (loads recent history)
        │
        ▼
  toolpack.generate()
        │
        ▼
  AgentResult.output
        │
        ▼
  CaptureInterceptor  ────────────────► ConversationStore.append()
  (after agent returns)                 (outbound turn recorded)
        │
        ▼
  channel.send()
```

The capture interceptor is **automatically prepended** to the interceptor chain. You do not need to configure it manually. History writes are non-fatal — a failed `append()` never crashes the agent.

---

## ConversationStore interface

```typescript
interface ConversationStore {
  append(message: StoredMessage): Promise<void>;
  get(conversationId: string, opts?: GetOptions): Promise<StoredMessage[]>;
  search(conversationId: string, query: string, opts?: SearchOptions): Promise<StoredMessage[]>;
  deleteMessages(conversationId: string, ids: string[]): Promise<void>;
}

interface GetOptions {
  scope?: ConversationScope;            // 'channel' | 'dm' | 'thread'
  sinceTimestamp?: string;              // ISO 8601 — only return messages after this timestamp
  limit?: number;
  participantIds?: string[];            // filter to messages from these participant IDs
}

interface SearchOptions {
  limit?: number;                       // default: 10
  tokenCap?: number;                    // max tokens across results (default: 2000)
}
```

---

## InMemoryConversationStore

The default store. Keeps all messages in process memory.

```typescript
import { InMemoryConversationStore } from '@toolpack-sdk/agents';

const store = new InMemoryConversationStore({
  maxConversations: 500,            // max distinct conversations kept (default: 500)
  maxMessagesPerConversation: 500,  // max messages per conversation (default: 500)
});
```

Assign it explicitly to control the capacity:

```typescript
class MyAgent extends BaseAgent {
  name = 'my-agent';
  description = '...';
  mode = 'chat';

  conversationHistory = new InMemoryConversationStore({ maxMessagesPerConversation: 200 });
}
```

**For production deployments** replace with a database-backed implementation. See [Replacing with a persistent store](#replacing-with-a-persistent-store).

---

## StoredMessage shape

```typescript
interface StoredMessage {
  id: string;                           // UUID
  conversationId: string;               // thread/session identifier
  participant: Participant;             // who sent this
  content: string;                      // message text
  timestamp: string;                    // ISO 8601
  scope: ConversationScope;             // 'channel' | 'dm' | 'thread'
  metadata?: {
    channelType?: string;               // channel platform (e.g. 'slack', 'discord')
    channelName?: string;               // channel name or identifier
    channelId?: string;                 // channel platform ID
    threadId?: string;                  // thread/parent message ID
    messageId?: string;                 // platform-specific message ID
    mentions?: string[];                // agent IDs mentioned in this message
    isSummary?: boolean;                // true for rolling-summary placeholder turns
  };
}

// Participant shape (from toolpack-sdk)
interface Participant {
  kind: 'user' | 'agent' | 'system';
  id: string;
  displayName?: string;
}

type ConversationScope = 'channel' | 'dm' | 'thread';
```

### Participant kinds

| Kind | Who writes it | LLM role in assembled prompt |
|---|---|---|
| `'user'` | Human end-users | `user` (prefixed with display name) |
| `'agent'` | This agent | `assistant` |
| `'agent'` (other) | Peer agents | `user` (prefixed with agent name + `(agent)`) |
| `'system'` | System messages | `system` |

---

## assemblePrompt()

`assemblePrompt()` is called inside `run()` to build the message array sent to the LLM. It applies filtering, projection, token budgeting, and optional rolling summarisation.

```typescript
import { assemblePrompt } from '@toolpack-sdk/agents';

const assembled = await assemblePrompt(
  store,            // ConversationStore
  conversationId,   // string
  agentId,          // agent's stable name/id (e.g. 'support-agent')
  agentName,        // display name for the LLM (usually same as agentId)
  options,          // AssemblerOptions (see below)
  summarizer,       // optional SummarizerAgent for rolling compression
);

// assembled.messages is Array<{ role: 'system'|'user'|'assistant', content: string }>
// Pass assembled.messages directly to toolpack.generate()
```

### What assemblePrompt does step-by-step

1. **Load history slice** — calls `store.get(conversationId, { scope, before, after, limit })`.
2. **Filter to relevant turns** (when `addressedOnlyMode = true`) — keeps only turns where:
   - The agent authored the turn (`participant.id === agentId`), OR
   - The agent was mentioned (`metadata.mentions` contains `agentId` or any of `agentAliases`)
3. **Project messages** — converts `StoredMessage` → `PromptMessage` from the agent's perspective (see table above).
4. **Rolling summarisation** — if turn count exceeds `rollingSummaryThreshold` and a `SummarizerAgent` is provided, older turns are compressed into a summary message.
5. **Token budget** — fills messages from most-recent to oldest until `tokenBudget` is exceeded. Token count is estimated as `characters / 4`.
6. **Return** `AssembledPrompt` with `messages[]` ready to spread into the LLM call.

---

## AssemblerOptions reference

```typescript
interface AssemblerOptions {
  scope?: ConversationScope;              // filter by scope (default: all)
  tokenBudget?: number;                   // max tokens for history (default: 3000)
  addressedOnlyMode?: boolean;            // filter to relevant turns (default: true)
  rollingSummaryThreshold?: number;       // compress when turns exceed this (default: 40)
  timeWindowMinutes?: number;             // ignore turns older than N minutes
  maxTurnsToLoad?: number;                // max turns to fetch from store (default: 100)
  agentAliases?: string[];               // platform bot IDs (e.g. Slack botUserId)
}
```

### Agent aliases

Slack and Telegram use platform-specific user IDs for bot mentions (e.g. `U123BOT`) which differ from the agent's `name` string. Set `agentAliases` (or let `BaseAgent` auto-populate from attached channels) so `assemblePrompt` recognises those mentions:

```typescript
agent.assemblerOptions = {
  agentAliases: ['U123BOT', 'telegram-bot-456'],
};
```

`BaseAgent._resolveAssemblerOptions()` auto-collects `botUserId` from channels that expose it (SlackChannel, TelegramChannel) and merges them with any manually specified aliases.

---

## Addressed-only mode

When `addressedOnlyMode: true` (the default), the assembler keeps only history turns where the agent was directly involved. This:

- Prevents loading irrelevant multi-party chatter into the context window
- Saves tokens in busy group channels
- Keeps the LLM focused on the relevant conversation thread

Turn `addressedOnlyMode` off only when you need full channel history — for example, a monitoring agent that analyses all traffic:

```typescript
agent.assemblerOptions = { addressedOnlyMode: false };
```

---

## Rolling summarisation

When history is long, the assembler can compress older turns into a summary rather than truncating them. Provide a `SummarizerAgent` to enable this:

```typescript
import { SummarizerAgent } from '@toolpack-sdk/agents';

// Create a dedicated summarizer
const summarizer = new SummarizerAgent({ apiKey: process.env.ANTHROPIC_API_KEY! });
await summarizer._ensureToolpack();

// Pass it to assemblePrompt (run() does not support this yet — call assemblePrompt manually)
const assembled = await assemblePrompt(
  store, conversationId, agent.name, agent.name,
  { rollingSummaryThreshold: 30, tokenBudget: 3000 },
  summarizer,
);
```

When `rollingSummaryThreshold` is exceeded, `SummarizerAgent` receives the oldest turns and returns a compact summary. The summary is inserted as a `system` message before the recent turns.

See [capabilities.md](capabilities.md) for the full `SummarizerAgent` API.

---

## conversation_search tool

`run()` automatically exposes a `conversation_search` tool to the LLM when a `conversationId` is active. The LLM can invoke it to retrieve specific past turns beyond the assembled context window.

The tool is defined as:

```
name: conversation_search
parameters:
  query: string    (keywords or phrases to search for)
  limit: number    (max results, default 5)
```

**Security note**: The tool uses a closure-captured `conversationId`. The LLM cannot supply or override the conversation ID, which prevents adversarial prompts from accessing other users' history.

---

## Replacing with a persistent store

For production, replace `InMemoryConversationStore` with a database-backed implementation. Implement the `ConversationStore` interface:

```typescript
import { ConversationStore, StoredMessage, GetOptions, SearchOptions } from '@toolpack-sdk/agents';
import Database from 'better-sqlite3';

class SQLiteConversationStore implements ConversationStore {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        participant_kind TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        participant_display_name TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        scope TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conv ON messages(conversation_id);
    `);
  }

  async append(message: StoredMessage): Promise<void> {
    this.db.prepare(`
      INSERT OR IGNORE INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.conversationId,
      message.participant.kind,
      message.participant.id,
      message.participant.displayName ?? null,
      message.content,
      message.timestamp,
      message.scope,
      message.metadata ? JSON.stringify(message.metadata) : null,
    );
  }

  async get(conversationId: string, opts: GetOptions = {}): Promise<StoredMessage[]> {
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE conversation_id = ?
       ${opts.sinceTimestamp ? 'AND timestamp > ?' : ''}
       ORDER BY timestamp ASC LIMIT ?`
    ).all(
      ...[conversationId, opts.sinceTimestamp, opts.limit ?? 100].filter(Boolean),
    );
    return rows.map(this.toStoredMessage);
  }

  async search(conversationId: string, query: string, opts: SearchOptions = {}): Promise<StoredMessage[]> {
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND content LIKE ? LIMIT ?`
    ).all(conversationId, `%${query}%`, opts.limit ?? 10);
    return rows.map(this.toStoredMessage);
  }

  async deleteMessages(conversationId: string, ids: string[]): Promise<void> {
    const placeholders = ids.map(() => '?').join(', ');
    this.db.prepare(
      `DELETE FROM messages WHERE conversation_id = ? AND id IN (${placeholders})`
    ).run(conversationId, ...ids);
  }

  private toStoredMessage(row: Record<string, unknown>): StoredMessage {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      participant: {
        kind: row.participant_kind as 'user' | 'agent' | 'system',
        id: row.participant_id as string,
        displayName: row.participant_display_name as string | undefined,
      },
      content: row.content as string,
      timestamp: row.timestamp as string,
      scope: row.scope as 'channel' | 'dm' | 'thread',
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }
}
```

Then assign it to your agent:

```typescript
class MyAgent extends BaseAgent {
  name = 'my-agent';
  description = '...';
  mode = 'chat';

  conversationHistory = new SQLiteConversationStore('./conversations.db');
}
```

### Sharing a store across agents

Multiple agents can share the same store. History is scoped by `conversationId`, so agents in the same conversation see each other's messages:

```typescript
const store = new SQLiteConversationStore('./shared.db');

agentA.conversationHistory = store;
agentB.conversationHistory = store;
```

This is the foundation for multi-agent conversation continuity.
