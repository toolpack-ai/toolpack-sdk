# Context Window Examples

This directory contains comprehensive examples demonstrating how to use the context window management features in Toolpack SDK.

## Overview

Context window management helps prevent API errors and handle long conversations by automatically managing conversation history within the model's token limits.

## Examples

### 1. Basic Pruning Example (`context-window-basic.ts`)

**What it demonstrates:**
- Simple setup of context window management with pruning strategy
- Automatic removal of oldest messages when approaching context limits
- Retention of system messages during pruning

**Key features:**
- Prune strategy (removes old messages)
- `pruneThreshold: 85` - Start pruning at 85% of context window
- `maxMessageHistoryLength: 50` - Keep at most 50 messages
- `retainSystemMessages: true` - Always preserve system prompts

**Use case:** Best for simple conversations where you just need to keep recent history without losing important context.

### 2. Summarization Example (`context-window-summarization.ts`)

**What it demonstrates:**
- Using summarization strategy to condense conversation history
- Automatic summarization of older messages before reaching limits
- Error handling for summarization failures

**Key features:**
- Summarize strategy (creates summaries of old messages)
- `summarizerModel: 'gpt-4'` - Use a capable model for summaries
- Automatic fallback to pruning if summarization fails
- Preserves full semantic meaning of conversations

**Use case:** Best for long, complex conversations where you need to preserve all the semantic information but save token space.

### 3. State Monitoring and Fail Strategy (`context-window-monitoring.ts`)

**What it demonstrates:**
- Monitoring conversation state and token usage
- Using the fail strategy for safety
- Error handling and recovery mechanisms
- Manual state management when needed

**Key features:**
- Fail strategy (prevents sending requests that exceed limits)
- `pruneThreshold: 90` - Alert at 90%, fail at 100%
- Error handling with `ContextWindowExceededError`
- Recovery strategies for when limits are exceeded

**Use case:** Best for safety-critical applications where you want explicit control and error handling rather than automatic pruning.

### 4. Multi-Conversation Tracking (`context-window-multi-conversation.ts`)

**What it demonstrates:**
- Managing context windows for multiple simultaneous conversations
- Per-conversation state tracking
- Resource management across conversations
- Advanced `MultiConversationContextManager` class

**Key features:**
- Separate conversation IDs for different users/threads
- Independent context window management per conversation
- Resource pooling and conversation archiving
- Statistics tracking across all conversations

**Use case:** Best for applications serving multiple users (chatbots, customer support, etc.) where each conversation needs independent context management.

## Running the Examples

### Prerequisites

```bash
# Install dependencies
npm install

# Set up your OpenAI API key
export OPENAI_API_KEY=sk_...
```

### Running a Specific Example

```bash
# Basic pruning
npx ts-node examples/context-window-basic.ts

# Summarization
npx ts-node examples/context-window-summarization.ts

# State monitoring
npx ts-node examples/context-window-monitoring.ts

# Multi-conversation
npx ts-node examples/context-window-multi-conversation.ts
```

## Configuration Options

All examples use these common configuration options:

```typescript
contextWindow: {
    // Enable/disable context window management
    enabled: boolean;
    
    // Strategy: 'prune' | 'summarize' | 'fail'
    strategy: 'prune' | 'summarize' | 'fail';
    
    // Threshold for triggering management (percentage, 0-100)
    pruneThreshold?: number; // Default: 85
    
    // Maximum messages to keep in history
    maxMessageHistoryLength?: number;
    
    // Always preserve system messages
    retainSystemMessages?: boolean; // Default: true
    
    // Model to use for summarization
    summarizerModel?: string;
    
    // Output token buffer (percentage overhead)
    outputTokenBuffer?: number; // Default: 1.15
}
```

## Strategy Comparison

| Strategy | Behavior | Best For | Tradeoffs |
|----------|----------|----------|-----------|
| **Prune** | Removes oldest messages | General conversations | May lose context |
| **Summarize** | Condenses old messages | Long complex conversations | More expensive (extra API call) |
| **Fail** | Throws error if limit exceeded | Safety-critical apps | Requires manual handling |

## Common Patterns

### Pattern 1: Long-Running Conversation

```typescript
// Use summarization to preserve context while saving tokens
contextWindow: {
    strategy: 'summarize',
    pruneThreshold: 80,
    summarizerModel: 'gpt-4'
}
```

### Pattern 2: Quick User Interactions

```typescript
// Use aggressive pruning to keep it fast and cheap
contextWindow: {
    strategy: 'prune',
    pruneThreshold: 90,
    maxMessageHistoryLength: 10
}
```

### Pattern 3: Critical Applications

```typescript
// Fail fast rather than silently lose context
contextWindow: {
    strategy: 'fail',
    pruneThreshold: 85
}
```

### Pattern 4: Multi-User System

```typescript
// Track each conversation separately with moderate settings
contextWindow: {
    strategy: 'prune',
    pruneThreshold: 85,
    maxMessageHistoryLength: 50,
    conversationId: `user-${userId}-session`
}
```

## Monitoring and Observability

All examples demonstrate best practices for monitoring:

- Track token usage per conversation
- Monitor context window utilization percentage
- Handle errors gracefully
- Implement recovery strategies
- Log state changes for debugging

## Next Steps

1. **Choose a strategy** based on your use case
2. **Test with your conversations** to find optimal thresholds
3. **Monitor performance** in production
4. **Adjust settings** based on metrics
5. **Handle errors** appropriately for your application

## Advanced Topics

- Custom context window state managers (see multi-conversation example)
- Integration with vector databases for semantic search over summaries
- Conversation archiving and retrieval
- Analytics and metrics collection
- Integration with observability platforms

## Troubleshooting

### Getting `ContextWindowExceededError`

Use fail strategy and handle the error:
```typescript
try {
    const response = await client.generate(...);
} catch (error) {
    if (error.code === 'CONTEXT_WINDOW_EXCEEDED') {
        // Implement recovery: archive, start new conversation, etc.
    }
}
```

### Summarization is slow

Consider using a faster model for summarization or increasing `pruneThreshold` to allow more tokens before summarization triggers.

### Losing important context

Switch from `prune` to `summarize` strategy, or increase `maxMessageHistoryLength`.

## See Also

- [API Documentation](../docs/API.md)
- [Context Window Implementation Plan](../../../CONTEXT_WINDOW_IMPLEMENTATION_PLAN.md)
- [Best Practices Guide](../docs/BEST_PRACTICES.md)
