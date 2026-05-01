import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryConversationStore } from './store.js';
import type { StoredMessage } from './conv-types.js';

function msg(overrides: Partial<StoredMessage> & { id: string }): StoredMessage {
  return {
    conversationId: 'conv-1',
    participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
    content: 'hello',
    timestamp: new Date().toISOString(),
    scope: 'channel',
    ...overrides,
  };
}

describe('InMemoryConversationStore', () => {
  let store: InMemoryConversationStore;

  beforeEach(() => {
    store = new InMemoryConversationStore();
  });

  describe('append', () => {
    it('should add a message', async () => {
      await store.append(msg({ id: '1', content: 'Hello' }));
      const messages = await store.get('conv-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('should be idempotent on duplicate id', async () => {
      await store.append(msg({ id: '1', content: 'Hello' }));
      await store.append(msg({ id: '1', content: 'Hello again' }));
      const messages = await store.get('conv-1');
      expect(messages).toHaveLength(1);
    });

    it('should maintain ascending timestamp order', async () => {
      await store.append(msg({ id: '2', timestamp: '2024-01-01T00:00:02Z', content: 'B' }));
      await store.append(msg({ id: '1', timestamp: '2024-01-01T00:00:01Z', content: 'A' }));
      const messages = await store.get('conv-1');
      expect(messages[0].content).toBe('A');
      expect(messages[1].content).toBe('B');
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      await store.append(msg({ id: '1', scope: 'channel', content: 'channel msg' }));
      await store.append(msg({ id: '2', scope: 'thread', content: 'thread msg' }));
      await store.append(msg({ id: '3', scope: 'dm', content: 'dm msg' }));
    });

    it('should return all messages without filter', async () => {
      const messages = await store.get('conv-1');
      expect(messages).toHaveLength(3);
    });

    it('should filter by scope', async () => {
      const messages = await store.get('conv-1', { scope: 'thread' });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('thread msg');
    });

    it('should return empty for unknown conversation', async () => {
      const messages = await store.get('unknown-conv');
      expect(messages).toHaveLength(0);
    });

    it('should apply limit to most recent N', async () => {
      const messages = await store.get('conv-1', { limit: 2 });
      expect(messages).toHaveLength(2);
    });

    it('should filter by participantIds', async () => {
      await store.append(msg({ id: '4', participant: { kind: 'agent', id: 'bot' }, content: 'bot msg' }));
      const messages = await store.get('conv-1', { participantIds: ['bot'] });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('bot msg');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.append(msg({ id: '1', content: 'The quick brown fox' }));
      await store.append(msg({ id: '2', content: 'jumped over the lazy dog' }));
      await store.append(msg({ id: '3', content: 'foxes are cunning' }));
    });

    it('should return matching messages', async () => {
      const results = await store.search('conv-1', 'fox');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.content.toLowerCase().includes('fox'))).toBe(true);
    });

    it('should return empty for no match', async () => {
      const results = await store.search('conv-1', 'zebra');
      expect(results).toHaveLength(0);
    });

    it('should respect limit', async () => {
      const results = await store.search('conv-1', 'fox', { limit: 1 });
      expect(results).toHaveLength(1);
    });
  });

  describe('deleteMessages', () => {
    it('should remove specified messages', async () => {
      await store.append(msg({ id: '1', content: 'A' }));
      await store.append(msg({ id: '2', content: 'B' }));
      await store.deleteMessages('conv-1', ['1']);
      const messages = await store.get('conv-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('B');
    });

    it('should be a no-op for unknown ids', async () => {
      await store.append(msg({ id: '1', content: 'A' }));
      await store.deleteMessages('conv-1', ['nonexistent']);
      const messages = await store.get('conv-1');
      expect(messages).toHaveLength(1);
    });
  });

  describe('clearConversation', () => {
    it('should remove all messages for a conversation', async () => {
      await store.append(msg({ id: '1', content: 'A' }));
      store.clearConversation('conv-1');
      const messages = await store.get('conv-1');
      expect(messages).toHaveLength(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least-recently-used conversation when capacity exceeded', async () => {
      const smallStore = new InMemoryConversationStore({ maxConversations: 2 });
      await smallStore.append(msg({ id: '1', conversationId: 'a' }));
      await smallStore.append(msg({ id: '2', conversationId: 'b' }));
      await smallStore.get('a');
      await smallStore.append(msg({ id: '3', conversationId: 'c' }));

      expect(await smallStore.get('a')).toHaveLength(1);
      expect(await smallStore.get('c')).toHaveLength(1);
    });
  });

  describe('maxMessagesPerConversation', () => {
    it('should drop oldest messages when cap is exceeded', async () => {
      const capped = new InMemoryConversationStore({ maxMessagesPerConversation: 3 });
      for (let i = 1; i <= 5; i++) {
        await capped.append(msg({
          id: String(i),
          content: `msg ${i}`,
          timestamp: `2024-01-01T00:00:0${i}Z`,
        }));
      }
      const messages = await capped.get('conv-1');
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('msg 3');
      expect(messages[2].content).toBe('msg 5');
    });
  });

  describe('isolation between conversations', () => {
    it('should keep conversations separate', async () => {
      await store.append(msg({ id: '1', conversationId: 'conv-a', content: 'A' }));
      await store.append(msg({ id: '2', conversationId: 'conv-b', content: 'B' }));

      const a = await store.get('conv-a');
      const b = await store.get('conv-b');

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0].content).toBe('A');
      expect(b[0].content).toBe('B');
    });
  });
});
