import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryConversationStore } from './store.js';
import { assemblePrompt } from './assembler.js';
import { createConversationSearchTool } from './search-tool.js';
import type { StoredMessage } from 'toolpack-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<StoredMessage> & { id: string }): StoredMessage {
  return {
    conversationId: 'conv-1',
    participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
    content: 'hello',
    timestamp: new Date().toISOString(),
    scope: 'channel',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InMemoryConversationStore
// ---------------------------------------------------------------------------

describe('InMemoryConversationStore', () => {
  describe('append / get', () => {
    it('stores and retrieves a message', async () => {
      const store = new InMemoryConversationStore();
      const msg = makeMessage({ id: 'm1' });

      await store.append(msg);
      const result = await store.get('conv-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('m1');
    });

    it('is idempotent — duplicate id is silently ignored', async () => {
      const store = new InMemoryConversationStore();
      const msg = makeMessage({ id: 'm1' });

      await store.append(msg);
      await store.append(msg);

      const result = await store.get('conv-1');
      expect(result).toHaveLength(1);
    });

    it('returns messages in ascending timestamp order', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm3', timestamp: '2024-01-01T00:00:03Z' }));
      await store.append(makeMessage({ id: 'm1', timestamp: '2024-01-01T00:00:01Z' }));
      await store.append(makeMessage({ id: 'm2', timestamp: '2024-01-01T00:00:02Z' }));

      const result = await store.get('conv-1');
      expect(result.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('returns empty array for unknown conversationId', async () => {
      const store = new InMemoryConversationStore();
      const result = await store.get('no-such-conversation');
      expect(result).toEqual([]);
    });

    it('isolates messages by conversationId', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm1', conversationId: 'conv-1' }));
      await store.append(makeMessage({ id: 'm2', conversationId: 'conv-2' }));

      expect(await store.get('conv-1')).toHaveLength(1);
      expect(await store.get('conv-2')).toHaveLength(1);
    });
  });

  describe('get — filtering', () => {
    it('filters by scope', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm1', scope: 'channel' }));
      await store.append(makeMessage({ id: 'm2', scope: 'thread' }));
      await store.append(makeMessage({ id: 'm3', scope: 'dm' }));

      const result = await store.get('conv-1', { scope: 'channel' });
      expect(result.map(m => m.id)).toEqual(['m1']);
    });

    it('filters by sinceTimestamp', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm1', timestamp: '2024-01-01T00:00:01Z' }));
      await store.append(makeMessage({ id: 'm2', timestamp: '2024-01-01T00:00:03Z' }));
      await store.append(makeMessage({ id: 'm3', timestamp: '2024-01-01T00:00:05Z' }));

      const result = await store.get('conv-1', { sinceTimestamp: '2024-01-01T00:00:03Z' });
      expect(result.map(m => m.id)).toEqual(['m2', 'm3']);
    });

    it('filters by participantIds', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm1', participant: { kind: 'user', id: 'u1' } }));
      await store.append(makeMessage({ id: 'm2', participant: { kind: 'user', id: 'u2' } }));
      await store.append(makeMessage({ id: 'm3', participant: { kind: 'agent', id: 'kael' } }));

      const result = await store.get('conv-1', { participantIds: ['u1', 'kael'] });
      expect(result.map(m => m.id)).toEqual(['m1', 'm3']);
    });

    it('respects limit (most recent N)', async () => {
      const store = new InMemoryConversationStore();

      for (let i = 1; i <= 5; i++) {
        await store.append(makeMessage({
          id: `m${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }

      const result = await store.get('conv-1', { limit: 3 });
      expect(result.map(m => m.id)).toEqual(['m3', 'm4', 'm5']);
    });
  });

  describe('search', () => {
    it('finds messages containing the query (case-insensitive)', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm1', content: 'Hello world' }));
      await store.append(makeMessage({ id: 'm2', content: 'Deploy to production' }));
      await store.append(makeMessage({ id: 'm3', content: 'Say hello again' }));

      const result = await store.search('conv-1', 'hello');
      const ids = result.map(m => m.id);
      expect(ids).toContain('m1');
      expect(ids).toContain('m3');
      expect(ids).not.toContain('m2');
    });

    it('returns empty array when no messages match', async () => {
      const store = new InMemoryConversationStore();
      await store.append(makeMessage({ id: 'm1', content: 'Hello world' }));

      const result = await store.search('conv-1', 'zxqwerty');
      expect(result).toHaveLength(0);
    });

    it('respects the limit option', async () => {
      const store = new InMemoryConversationStore();

      for (let i = 1; i <= 5; i++) {
        await store.append(makeMessage({ id: `m${i}`, content: `match ${i}` }));
      }

      const result = await store.search('conv-1', 'match', { limit: 3 });
      expect(result).toHaveLength(3);
    });

    it('never crosses conversationId boundaries', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm1', conversationId: 'conv-1', content: 'hello' }));
      await store.append(makeMessage({ id: 'm2', conversationId: 'conv-2', content: 'hello' }));

      const result = await store.search('conv-1', 'hello');
      expect(result.every(m => m.conversationId === 'conv-1')).toBe(true);
    });
  });

  describe('memory bounds', () => {
    it('evicts oldest conversation when maxConversations is exceeded', async () => {
      const store = new InMemoryConversationStore({ maxConversations: 2 });

      await store.append(makeMessage({ id: 'm1', conversationId: 'conv-1' }));
      await store.append(makeMessage({ id: 'm2', conversationId: 'conv-2' }));
      // conv-1 is now LRU
      await store.append(makeMessage({ id: 'm3', conversationId: 'conv-3' }));

      // conv-1 should have been evicted
      expect(store.conversationCount).toBe(2);
      const conv1 = await store.get('conv-1');
      expect(conv1).toHaveLength(0);
    });

    it('drops oldest messages when maxMessagesPerConversation is exceeded', async () => {
      const store = new InMemoryConversationStore({ maxMessagesPerConversation: 3 });

      for (let i = 1; i <= 5; i++) {
        await store.append(makeMessage({
          id: `m${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }

      const result = await store.get('conv-1');
      // Only the 3 most recent should remain
      expect(result).toHaveLength(3);
      expect(result.map(m => m.id)).toEqual(['m3', 'm4', 'm5']);
    });
  });

  describe('clearConversation', () => {
    it('removes all messages for a conversation', async () => {
      const store = new InMemoryConversationStore();

      await store.append(makeMessage({ id: 'm1' }));
      store.clearConversation('conv-1');

      const result = await store.get('conv-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('deleteMessages', () => {
    it('removes messages by id, leaving others intact', async () => {
      const store = new InMemoryConversationStore();
      await store.append(makeMessage({ id: 'm1' }));
      await store.append(makeMessage({ id: 'm2' }));
      await store.append(makeMessage({ id: 'm3' }));

      await store.deleteMessages('conv-1', ['m1', 'm3']);

      const result = await store.get('conv-1');
      expect(result.map(m => m.id)).toEqual(['m2']);
    });

    it('is a no-op for ids that do not exist', async () => {
      const store = new InMemoryConversationStore();
      await store.append(makeMessage({ id: 'm1' }));

      await store.deleteMessages('conv-1', ['no-such-id']);

      const result = await store.get('conv-1');
      expect(result).toHaveLength(1);
    });

    it('is a no-op for an unknown conversationId', async () => {
      const store = new InMemoryConversationStore();
      // Should not throw
      await expect(store.deleteMessages('no-such-conv', ['m1'])).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

describe('assemblePrompt', () => {
  let store: InMemoryConversationStore;

  beforeEach(() => {
    store = new InMemoryConversationStore();
  });

  it('returns empty messages when the store is empty', async () => {
    const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael');
    expect(result.messages).toHaveLength(0);
    expect(result.turnsLoaded).toBe(0);
    expect(result.hasSummary).toBe(false);
  });

  describe('per-agent projection', () => {
    it('renders system participant as system role', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'system', id: 'system' },
        content: 'Channel topic: support',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: false });
      expect(result.messages[0]).toEqual({ role: 'system', content: 'Channel topic: support' });
    });

    it('renders user participant as user role with displayName prefix', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
        content: 'Hey kael',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: false });
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Alice: Hey kael' });
    });

    it('falls back to participant.id when displayName is absent', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'user', id: 'u1' },
        content: 'Hello',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: false });
      expect(result.messages[0].content).toBe('u1: Hello');
    });

    it('renders current agent turns as assistant role', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'agent', id: 'kael', displayName: 'Kael' },
        content: 'Sure, I can help with that.',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: false });
      expect(result.messages[0]).toEqual({ role: 'assistant', content: 'Sure, I can help with that.' });
    });

    it('renders peer agent turns as user role with "(agent)" label', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'agent', id: 'nova', displayName: 'Nova' },
        content: 'I handled the first part.',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: false });
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Nova (agent): I handled the first part.' });
    });
  });

  describe('addressed-only mode', () => {
    it('includes messages sent by the agent', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'agent', id: 'kael' },
        content: 'I replied earlier.',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: true });
      expect(result.messages).toHaveLength(1);
    });

    it('includes messages that @-mention the agent by stable name', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'user', id: 'u1' },
        content: 'hey kael can you help?',
        metadata: { mentions: ['kael'] },
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: true });
      expect(result.messages).toHaveLength(1);
    });

    it('includes messages that @-mention the agent by platform id (agentAliases)', async () => {
      // Slack stores mentions as platform user ids like 'U_BOT123', not the
      // stable agent name 'kael'. Without agentAliases this message would be
      // excluded from the addressed-only filter even though it is directed at
      // the bot.
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'user', id: 'u1' },
        content: 'hey <@U_BOT123> can you deploy?',
        metadata: { mentions: ['U_BOT123'] },
      }));

      // Without the alias → message is not included (demonstrates the bug).
      const withoutAlias = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', {
        addressedOnlyMode: true,
        maxTurnsToLoad: 100,
      });
      // m1 is the most-recent (triggering) message so it's always included even
      // without the alias; add a second unrelated message first to show the difference.
      //
      // Rebuild with a proper setup:

      const store2 = new InMemoryConversationStore();
      // Side conversation (no mention of bot)
      await store2.append(makeMessage({ id: 'side', conversationId: 'c2', participant: { kind: 'user', id: 'u2' }, content: 'lunch?' }));
      // Bot mention by platform id
      await store2.append(makeMessage({ id: 'bot-msg', conversationId: 'c2', participant: { kind: 'user', id: 'u1' }, content: 'hey can you deploy?', metadata: { mentions: ['U_BOT123'] } }));
      // More recent unrelated message so bot-msg is NOT the triggering message
      await store2.append(makeMessage({ id: 'after', conversationId: 'c2', participant: { kind: 'user', id: 'u2' }, content: 'never mind' }));

      // Without alias: bot-msg is excluded (only 'after' is the triggering message)
      const noAlias = await assemblePrompt(store2, 'c2', 'kael', 'Kael', { addressedOnlyMode: true });
      expect(noAlias.messages.some(m => m.content.includes('deploy'))).toBe(false);

      // With alias: bot-msg is included because 'U_BOT123' is in agentAllIds
      const withAlias = await assemblePrompt(store2, 'c2', 'kael', 'Kael', {
        addressedOnlyMode: true,
        agentAliases: ['U_BOT123'],
      });
      expect(withAlias.messages.some(m => m.content.includes('deploy'))).toBe(true);
    });

    it('excludes side conversations the agent was not involved in', async () => {
      // Alice and Bob chatting — no mention of kael
      await store.append(makeMessage({ id: 'm1', participant: { kind: 'user', id: 'u1' }, content: 'lunch?' }));
      await store.append(makeMessage({ id: 'm2', participant: { kind: 'user', id: 'u2' }, content: 'sure!' }));
      // Carol mentions kael in the last message (triggering message always included)
      await store.append(makeMessage({
        id: 'm3',
        participant: { kind: 'user', id: 'u3' },
        content: 'kael can you help?',
        metadata: { mentions: ['kael'] },
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: true });
      // Only m3 (involved) should be in the prompt
      const contents = result.messages.map(m => m.content);
      expect(contents.some(c => c.includes('lunch'))).toBe(false);
      expect(contents.some(c => c.includes('kael can you help'))).toBe(true);
    });

    it('always includes the most recent message even if agent is not involved', async () => {
      // A random message with no mention of kael — but it's the most recent
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'user', id: 'u1' },
        content: 'hey everyone',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', { addressedOnlyMode: true });
      // The triggering (most recent) message is always included
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('token budget', () => {
    it('drops oldest messages when budget is exceeded', async () => {
      // Each message is ~100 chars = ~25 tokens; budget of 40 tokens fits ~1-2 messages
      for (let i = 1; i <= 5; i++) {
        await store.append(makeMessage({
          id: `m${i}`,
          participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
          content: `${'x'.repeat(80)} message ${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', {
        addressedOnlyMode: false,
        tokenBudget: 30,
      });

      // Only the most recent message(s) that fit in 30 tokens should appear
      expect(result.messages.length).toBeLessThan(5);
      // The most recent message must be included
      const lastContent = result.messages[result.messages.length - 1]?.content ?? '';
      expect(lastContent).toContain('message 5');
    });

    it('always includes the triggering (most recent) message even if it alone exceeds the budget', async () => {
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
        content: 'x'.repeat(2000), // ~500 tokens — far over any small budget
        timestamp: '2024-01-01T00:00:01Z',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', {
        addressedOnlyMode: false,
        tokenBudget: 10, // tiny budget
      });

      // Must still include the single message, not return empty
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('rolling summary', () => {
    it('calls the summariser when turn count exceeds threshold', async () => {
      for (let i = 1; i <= 6; i++) {
        await store.append(makeMessage({
          id: `m${i}`,
          participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
          content: `message ${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }

      const mockSummariser = {
        invokeAgent: vi.fn().mockResolvedValue({
          output: JSON.stringify({
            summary: 'Earlier messages discussed general topics.',
            turnsSummarized: 3,
            hasDecisions: false,
            estimatedTokens: 20,
          }),
        }),
      } as any;

      const result = await assemblePrompt(
        store,
        'conv-1',
        'kael',
        'Kael',
        { addressedOnlyMode: false, rollingSummaryThreshold: 4 },
        mockSummariser
      );

      expect(mockSummariser.invokeAgent).toHaveBeenCalled();
      expect(result.hasSummary).toBe(true);
      // The assembled messages should include the summary entry
      const summaryMsg = result.messages.find(m => m.content.includes('[Summary of'));
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg?.role).toBe('system');
    });

    it('does not call summariser when turn count is under threshold', async () => {
      await store.append(makeMessage({ id: 'm1', content: 'hello' }));
      await store.append(makeMessage({ id: 'm2', content: 'world' }));

      const mockSummariser = { invokeAgent: vi.fn() } as any;

      const result = await assemblePrompt(
        store,
        'conv-1',
        'kael',
        'Kael',
        { addressedOnlyMode: false, rollingSummaryThreshold: 10 },
        mockSummariser
      );

      expect(mockSummariser.invokeAgent).not.toHaveBeenCalled();
      expect(result.hasSummary).toBe(false);
    });

    it('falls back gracefully when summariser throws', async () => {
      for (let i = 1; i <= 6; i++) {
        await store.append(makeMessage({
          id: `m${i}`,
          content: `message ${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }

      const mockSummariser = {
        invokeAgent: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      } as any;

      // Should not throw even if summariser fails
      const result = await assemblePrompt(
        store,
        'conv-1',
        'kael',
        'Kael',
        { addressedOnlyMode: false, rollingSummaryThreshold: 4 },
        mockSummariser
      );

      expect(result.hasSummary).toBe(false);
      // Still returns some messages
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('persists the summary to the store and deletes summarised turns (gap #2)', async () => {
      for (let i = 1; i <= 6; i++) {
        await store.append(makeMessage({
          id: `m${i}`,
          content: `message ${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }

      const mockSummariser = {
        invokeAgent: vi.fn().mockResolvedValue({
          output: JSON.stringify({
            summary: 'Earlier messages covered general topics.',
            turnsSummarized: 3,
            hasDecisions: false,
            estimatedTokens: 20,
          }),
        }),
      } as any;

      await assemblePrompt(
        store,
        'conv-1',
        'kael',
        'Kael',
        { addressedOnlyMode: false, rollingSummaryThreshold: 4 },
        mockSummariser
      );

      const stored = await store.get('conv-1');

      // The summarised turns (m1–m3, the first half) should have been removed.
      const ids = stored.map(m => m.id);
      expect(ids).not.toContain('m1');
      expect(ids).not.toContain('m2');
      expect(ids).not.toContain('m3');

      // A persisted summary entry should be present.
      const summaryEntry = stored.find(m => m.metadata?.isSummary);
      expect(summaryEntry).toBeDefined();
      expect(summaryEntry?.participant.kind).toBe('system');

      // The recent turns (m4–m6, the second half) must still be there.
      expect(ids).toContain('m4');
      expect(ids).toContain('m5');
      expect(ids).toContain('m6');
    });

    it('does not re-summarise an existing isSummary turn (gap #8)', async () => {
      // Prime the store with an already-persisted summary + some new turns.
      await store.append(makeMessage({
        id: 'summary-old',
        participant: { kind: 'system', id: 'summarizer' },
        content: '[Summary of 3 earlier turns]: key context.',
        timestamp: '2024-01-01T00:00:01Z',
        metadata: { isSummary: true },
      }));
      for (let i = 2; i <= 6; i++) {
        await store.append(makeMessage({
          id: `m${i}`,
          content: `message ${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }

      const mockSummariser = {
        invokeAgent: vi.fn().mockResolvedValue({
          output: JSON.stringify({
            summary: 'New summary.',
            turnsSummarized: 2,
            hasDecisions: false,
            estimatedTokens: 10,
          }),
        }),
      } as any;

      await assemblePrompt(
        store,
        'conv-1',
        'kael',
        'Kael',
        { addressedOnlyMode: false, rollingSummaryThreshold: 4 },
        mockSummariser
      );

      // The summariser should have been called, but only with the raw turns —
      // not with the existing isSummary entry.
      expect(mockSummariser.invokeAgent).toHaveBeenCalled();
      const calledWith = mockSummariser.invokeAgent.mock.calls[0][0];
      const turns = calledWith.data.turns as Array<{ id: string }>;
      expect(turns.some(t => t.id === 'summary-old')).toBe(false);
    });
  });

  describe('addressed-only mode — replied-next criterion (gap #3)', () => {
    it('includes a message that was immediately replied to by the agent', async () => {
      // u1 sends a message (no mention of kael)
      await store.append(makeMessage({
        id: 'm1',
        participant: { kind: 'user', id: 'u1' },
        content: 'anyone know the deploy status?',
        timestamp: '2024-01-01T00:00:01Z',
      }));
      // kael replies next — so m1 should be included via "replied next"
      await store.append(makeMessage({
        id: 'm2',
        participant: { kind: 'agent', id: 'kael' },
        content: 'Deploy is done.',
        timestamp: '2024-01-01T00:00:02Z',
      }));
      // unrelated side conversation
      await store.append(makeMessage({
        id: 'm3',
        participant: { kind: 'user', id: 'u2' },
        content: 'cool, thanks',
        timestamp: '2024-01-01T00:00:03Z',
      }));

      const result = await assemblePrompt(store, 'conv-1', 'kael', 'Kael', {
        addressedOnlyMode: true,
      });

      const contents = result.messages.map(m => m.content);
      // m1 ("anyone know…") must be included because kael replied right after it
      expect(contents.some(c => c.includes('deploy status'))).toBe(true);
      // m2 (kael's reply) is included as the agent's own turn
      expect(contents.some(c => c.includes('Deploy is done'))).toBe(true);
      // m3 is the triggering (most recent) message — always included
      expect(contents.some(c => c.includes('cool, thanks'))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// createConversationSearchTool
// ---------------------------------------------------------------------------

describe('createConversationSearchTool', () => {
  let store: InMemoryConversationStore;

  beforeEach(async () => {
    store = new InMemoryConversationStore();
    await store.append(makeMessage({ id: 'm1', content: 'deploy the service' }));
    await store.append(makeMessage({ id: 'm2', content: 'the deployment failed' }));
    await store.append(makeMessage({ id: 'm3', content: 'let\'s discuss lunch plans' }));
  });

  it('has the correct tool name and schema', () => {
    const tool = createConversationSearchTool(store, 'conv-1');
    expect(tool.name).toBe('search_conversation_history');
    expect(tool.input_schema.required).toContain('query');
  });

  it('returns formatted results for matching messages', async () => {
    const tool = createConversationSearchTool(store, 'conv-1');
    const result = await tool.execute({ query: 'deploy' });

    expect(result).toContain('deploy the service');
    expect(result).toContain('deployment failed');
    expect(result).not.toContain('lunch');
  });

  it('returns a "not found" message when no results match', async () => {
    const tool = createConversationSearchTool(store, 'conv-1');
    const result = await tool.execute({ query: 'zxqwerty' });

    expect(result).toContain('No messages found');
  });

  it('returns an error message for an empty query', async () => {
    const tool = createConversationSearchTool(store, 'conv-1');
    const result = await tool.execute({ query: '' });

    expect(result).toContain('Error');
  });

  it('is scope-locked — only searches the given conversationId', async () => {
    await store.append(makeMessage({ id: 'm4', conversationId: 'conv-2', content: 'deploy from conv-2' }));

    const tool = createConversationSearchTool(store, 'conv-1');
    const result = await tool.execute({ query: 'deploy' });

    // conv-2 message must not appear
    expect(result).not.toContain('conv-2');
  });

  it('respects maxResults config', async () => {
    const tool = createConversationSearchTool(store, 'conv-1', { maxResults: 1 });
    const result = await tool.execute({ query: 'deploy' });

    // With maxResults: 1, only one result should appear
    const lines = result.split('\n').filter(l => l.startsWith('['));
    expect(lines).toHaveLength(1);
  });
});
