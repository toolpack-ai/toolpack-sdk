# Conversation History

Store conversation history separately from domain knowledge.

## Quick Start

```typescript
import { ConversationHistory } from '@toolpack-sdk/agents';

// Development (in-memory, fast, lost on restart)
const history = new ConversationHistory();

// Production (SQLite, persists across restarts)
const history = new ConversationHistory('./conversations.db');
```

## Usage in Agents

```typescript
import { BaseAgent, ConversationHistory } from '@toolpack-sdk/agents';

export class SupportAgent extends BaseAgent {
  name = 'support';
  mode = 'chat';

  // Conversation history auto-manages messages
  conversationHistory = new ConversationHistory('./history.db');
}
```

The agent automatically:
1. Loads previous messages before each AI call
2. Stores new messages after each response
3. Trims to `maxMessages` limit (default: 20)

## API

### `new ConversationHistory()`

**In-memory mode:**
```typescript
const history = new ConversationHistory();                           // Default maxMessages: 20
const history = new ConversationHistory({ maxMessages: 50 });        // Custom limit
```

**SQLite mode:**
```typescript
// String shorthand
const history = new ConversationHistory('./history.db');

// Options object
const history = new ConversationHistory({
  path: './history.db',
  maxMessages: 50,
  limit: 10,              // Messages sent to AI context (default: 10)
  searchIndex: true,      // Enable conversation search (default: false)
});
```

### Methods

```typescript
// Get last N messages for AI context
const messages = await history.getHistory('conversation-id', 10);

// Add messages
await history.addUserMessage('conv-1', 'Hello!', 'support-agent');
await history.addAssistantMessage('conv-1', 'Hi! How can I help?');
await history.addSystemMessage('conv-1', 'You are a helpful assistant.');

// Get message count (useful for debugging)
const count = await history.count('conv-1');

// Check if using persistent storage
if (history.isPersistent) {
  console.log('Using SQLite storage');
}

// Clear a conversation
await history.clear('conv-1');

// Close SQLite connection (no-op for in-memory)
history.close();
```

## Options

```typescript
interface ConversationHistoryOptions {
  path?: string;          // SQLite file path (omit for in-memory)
  maxMessages?: number;   // Max messages per conversation (default: 20)
  limit?: number;         // Messages sent to AI context (default: 10)
  searchIndex?: boolean;  // Enable conversation search (SQLite only, default: false)
}
```

## Why Separate from Knowledge?

| Without Separation | With Separation |
|-------------------|-----------------|
| Messages pollute knowledge search | Clean knowledge search results |
| Unnecessary embedding overhead | No vector storage for messages |
| Complex cleanup logic | Simple per-conversation limits |

## Custom Storage

Need Redis or PostgreSQL? The class accepts any object with `getHistory` and `addXxxMessage` methods:

```typescript
const history = new ConversationHistory({
  path: undefined,  // In-memory base
  maxMessages: 100,
});

// Or implement your own storage logic by extending the class
```

## Best Practices

- **Development:** Use in-memory mode (default)
- **Production:** Use SQLite with a file path
- **Max messages:** Keep under 50 to prevent context overflow
- **Cleanup:** SQLite auto-trims on insert; in-memory trims continuously

## Conversation Search

Enable full-text search to let the AI find information from earlier in the conversation:

```typescript
const history = new ConversationHistory({
  path: './history.db',
  searchIndex: true,  // Enable BM25 search
});

// In your agent, the AI gets a `conversation_search` tool automatically
// when searchIndex is enabled

class SmartAgent extends BaseAgent {
  conversationHistory = new ConversationHistory({
    path: './history.db',
    limit: 10,           // Send last 10 messages to AI
    maxMessages: 1000,   // Store up to 1000 messages
    searchIndex: true,   // Enable search for old messages
  });
}

// The AI can now search old messages:
// User: "What did I say about the API rate limit?"
// AI: [Calls conversation_search("API rate limit")]
// AI: "Earlier you mentioned the API has a 100 req/min limit."
```

### Manual Search

```typescript
// Search conversation history
const results = await history.search('conv-1', 'API rate limit', 5);
// Returns up to 5 most relevant messages
```

### Get Search Tool for Custom Use

```typescript
const tool = history.toTool('conv-1');
const result = await tool.execute({ query: 'database schema' });
```

## Error Handling

### Missing better-sqlite3

If using SQLite mode without installing the dependency:

```typescript
const history = new ConversationHistory('./history.db');
// Throws: SQLite mode requires better-sqlite3. Install: npm install better-sqlite3
```

**Fix:** Install the peer dependency:
```bash
npm install better-sqlite3
```

### Invalid Database Path

If the SQLite file path is invalid or permissions are denied:

```typescript
try {
  const history = new ConversationHistory('/invalid/path/history.db');
} catch (error) {
  console.error('Failed to create history:', error.message);
  // Fallback to in-memory
  const history = new ConversationHistory();
}
```

### Storage Operations

All storage operations are wrapped in try-catch in the agent. If history storage fails, the agent continues without crashing:

```typescript
// In BaseAgent, storage failures are non-fatal
try {
  await this.conversationHistory.addUserMessage(id, message);
} catch {
  // If history storage fails, continue without crashing
}
```

## Migration

**Before (messages in knowledge base):**
```typescript
// Conversation messages mixed with docs - don't do this
```

**After (separate storage):**
```typescript
// Domain knowledge (for search)
knowledge = await Knowledge.create({...});

// Conversation history (separate!)
conversationHistory = new ConversationHistory('./history.db');
```

**Backward compatible:** Agents work without `conversationHistory` (stateless mode).
