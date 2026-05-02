import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteConversationStore } from './stores/sqlite-store.js';
import type { StoredMessage } from './types.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function msg(overrides: Partial<StoredMessage> & { id: string }): StoredMessage {
  return {
    conversationId: 'conv-1',
    participant: { kind: 'user', id: 'u1', displayName: 'Alice' },
    content: 'hello',
    timestamp: new Date().toISOString(),
    scope: 'channel',
    ...overrides,
  } as StoredMessage;
}

describe('SQLiteConversationStore', () => {
  let store: SQLiteConversationStore;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-sqlite-'));
    dbPath = path.join(tmpDir, 'conv.sqlite');
    store = new SQLiteConversationStore({ dbPath });
  });

  afterEach(() => {
    try { store.close(); } catch { /* cleanup */ }
    try { if (fs.existsSync(dbPath)) fs.rmSync(dbPath); } catch { /* cleanup */ }
    try { if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir); } catch { /* cleanup */ }
  });

  describe('append', () => {
    it('should add a message and be idempotent', async () => {
      await store.append(msg({ id: '1', content: 'Hello' }));
      await store.append(msg({ id: '1', content: 'Hello again' }));
      const messages = await store.get('conv-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
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

  describe('maxMessagesPerConversation', () => {
    it('should drop oldest messages when cap is exceeded', async () => {
      const capped = new SQLiteConversationStore({ dbPath: path.join(tmpDir, 'cap.sqlite'), maxMessagesPerConversation: 3 });
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
      capped.close();
    });
  });
});
