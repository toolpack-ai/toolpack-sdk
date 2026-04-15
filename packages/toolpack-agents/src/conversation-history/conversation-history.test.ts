import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationHistory } from './index.js';

describe('ConversationHistory (In-Memory)', () => {
  let history: ConversationHistory;

  beforeEach(() => {
    // In-memory mode: no path provided
    history = new ConversationHistory({ maxMessages: 5 });
  });

  describe('addUserMessage', () => {
    it('should add a user message', async () => {
      await history.addUserMessage('conv-1', 'Hello', 'test-agent');

      const messages = await history.getHistory('conv-1');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello',
        agentName: 'test-agent',
      });
      expect(messages[0].timestamp).toBeDefined();
    });
  });

  describe('addAssistantMessage', () => {
    it('should add an assistant message', async () => {
      await history.addAssistantMessage('conv-1', 'Hi there!', 'test-agent');

      const messages = await history.getHistory('conv-1');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        content: 'Hi there!',
        agentName: 'test-agent',
      });
    });
  });

  describe('getHistory', () => {
    it('should return messages in chronological order', async () => {
      await history.addUserMessage('conv-1', 'Message 1');
      await history.addAssistantMessage('conv-1', 'Response 1');
      await history.addUserMessage('conv-1', 'Message 2');

      const messages = await history.getHistory('conv-1');
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('Message 1');
      expect(messages[1].content).toBe('Response 1');
      expect(messages[2].content).toBe('Message 2');
    });

    it('should respect limit parameter', async () => {
      await history.addUserMessage('conv-1', 'Message 1');
      await history.addAssistantMessage('conv-1', 'Response 1');
      await history.addUserMessage('conv-1', 'Message 2');
      await history.addAssistantMessage('conv-1', 'Response 2');

      const messages = await history.getHistory('conv-1', 2);
      expect(messages).toHaveLength(2);
      // Should return last 2 messages
      expect(messages[0].content).toBe('Message 2');
      expect(messages[1].content).toBe('Response 2');
    });

    it('should return empty array for non-existent conversation', async () => {
      const messages = await history.getHistory('non-existent');
      expect(messages).toHaveLength(0);
    });
  });

  describe('maxMessages trimming', () => {
    it('should trim old messages when maxMessages is exceeded', async () => {
      // maxMessages is 5
      await history.addUserMessage('conv-1', 'Message 1');
      await history.addAssistantMessage('conv-1', 'Response 1');
      await history.addUserMessage('conv-1', 'Message 2');
      await history.addAssistantMessage('conv-1', 'Response 2');
      await history.addUserMessage('conv-1', 'Message 3');
      await history.addAssistantMessage('conv-1', 'Response 3'); // 6th message

      const messages = await history.getHistory('conv-1');
      expect(messages).toHaveLength(5);
      // First message should be trimmed
      expect(messages[0].content).toBe('Response 1');
      expect(messages[4].content).toBe('Response 3');
    });
  });

  describe('clear', () => {
    it('should clear all messages for a conversation', async () => {
      await history.addUserMessage('conv-1', 'Message 1');
      await history.addAssistantMessage('conv-1', 'Response 1');

      await history.clear('conv-1');

      const messages = await history.getHistory('conv-1');
      expect(messages).toHaveLength(0);
    });

    it('should not affect other conversations', async () => {
      await history.addUserMessage('conv-1', 'Message 1');
      await history.addUserMessage('conv-2', 'Message 2');

      await history.clear('conv-1');

      const conv1Messages = await history.getHistory('conv-1');
      const conv2Messages = await history.getHistory('conv-2');

      expect(conv1Messages).toHaveLength(0);
      expect(conv2Messages).toHaveLength(1);
    });
  });

  describe('isolation between conversations', () => {
    it('should keep conversations separate', async () => {
      await history.addUserMessage('conv-1', 'Conv 1 Message');
      await history.addUserMessage('conv-2', 'Conv 2 Message');

      const conv1 = await history.getHistory('conv-1');
      const conv2 = await history.getHistory('conv-2');

      expect(conv1).toHaveLength(1);
      expect(conv2).toHaveLength(1);
      expect(conv1[0].content).toBe('Conv 1 Message');
      expect(conv2[0].content).toBe('Conv 2 Message');
    });
  });

  describe('addSystemMessage', () => {
    it('should add a system message', async () => {
      await history.addSystemMessage('conv-1', 'You are a helpful assistant.');

      const messages = await history.getHistory('conv-1');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
    });
  });

  describe('count', () => {
    it('should return correct message count', async () => {
      expect(await history.count('conv-1')).toBe(0);
      
      await history.addUserMessage('conv-1', 'Message 1');
      expect(await history.count('conv-1')).toBe(1);
      
      await history.addAssistantMessage('conv-1', 'Response 1');
      expect(await history.count('conv-1')).toBe(2);
    });

    it('should return 0 for non-existent conversation', async () => {
      expect(await history.count('non-existent')).toBe(0);
    });
  });

  describe('isPersistent', () => {
    it('should return false for in-memory mode', () => {
      expect(history.isPersistent).toBe(false);
    });
  });

  describe('search', () => {
    it('should search messages in memory mode', async () => {
      await history.addUserMessage('conv-1', 'What is the API rate limit?');
      await history.addAssistantMessage('conv-1', 'The rate limit is 100 requests per minute.');
      await history.addUserMessage('conv-1', 'What about error handling?');

      const results = await history.search('conv-1', 'rate limit');
      
      expect(results).toHaveLength(2);
      expect(results[0].content).toContain('rate limit');
      expect(results[1].content).toContain('rate limit');
    });

    it('should return empty array when no matches found', async () => {
      await history.addUserMessage('conv-1', 'Hello world');
      
      const results = await history.search('conv-1', 'nonexistent');
      
      expect(results).toHaveLength(0);
    });

    it('should respect search limit', async () => {
      await history.addUserMessage('conv-1', 'Test message 1');
      await history.addUserMessage('conv-1', 'Test message 2');
      await history.addUserMessage('conv-1', 'Test message 3');

      const results = await history.search('conv-1', 'Test', 2);
      
      expect(results).toHaveLength(2);
    });

    it('should return empty array for non-existent conversation', async () => {
      const results = await history.search('non-existent', 'query');
      expect(results).toHaveLength(0);
    });
  });

  describe('toTool', () => {
    it('should create a search tool for AI', async () => {
      await history.addUserMessage('conv-1', 'API documentation: https://docs.example.com');
      
      const tool = history.toTool('conv-1');
      
      expect(tool.name).toBe('conversation_search');
      expect(tool.description).toContain('Search past conversation history');
      expect(tool.parameters.properties.query).toBeDefined();
      
      // Test tool execution
      const result = await tool.execute({ query: 'API documentation', limit: 5 });
      
      expect(result.count).toBe(1);
      expect(result.results[0].content).toContain('API documentation');
    });
  });

  describe('configurable limit', () => {
    it('should use custom limit from options', () => {
      const customHistory = new ConversationHistory({ maxMessages: 20, limit: 5 });
      expect(customHistory.getHistoryLimit()).toBe(5);
    });

    it('should default limit to 10', () => {
      expect(history.getHistoryLimit()).toBe(10);
    });

    it('should allow limit override in getHistory', async () => {
      await history.addUserMessage('conv-1', 'Message 1');
      await history.addUserMessage('conv-1', 'Message 2');
      await history.addUserMessage('conv-1', 'Message 3');

      // Should respect explicit limit
      const messages = await history.getHistory('conv-1', 2);
      expect(messages).toHaveLength(2);
    });
  });

  describe('search with trimmed messages', () => {
    it('should not return trimmed messages in search results', async () => {
      // Create history with small maxMessages to trigger trimming
      const smallHistory = new ConversationHistory({ maxMessages: 3 });
      
      // Add messages beyond limit
      await smallHistory.addUserMessage('conv-1', 'First message about cats');
      await smallHistory.addUserMessage('conv-1', 'Second message about dogs');
      await smallHistory.addUserMessage('conv-1', 'Third message about birds');
      await smallHistory.addUserMessage('conv-1', 'Fourth message about fish');
      
      // Search for "cats" - should not find it (trimmed)
      const results = await smallHistory.search('conv-1', 'cats');
      expect(results).toHaveLength(0);
      
      // Search for "fish" - should find it (recent)
      const fishResults = await smallHistory.search('conv-1', 'fish');
      expect(fishResults).toHaveLength(1);
      expect(fishResults[0].content).toContain('fish');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      await history.addUserMessage('conv-1', '');
      const messages = await history.getHistory('conv-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('');
    });

    it('should handle special characters in content', async () => {
      const specialContent = 'Hello\nWorld\t! "Quotes" \'Apostrophes\' <tags> &amp; entities';
      await history.addUserMessage('conv-1', specialContent);
      const messages = await history.getHistory('conv-1');
      expect(messages[0].content).toBe(specialContent);
    });

    it('should handle long conversation IDs', async () => {
      const longId = 'a'.repeat(500);
      await history.addUserMessage(longId, 'Test');
      const messages = await history.getHistory(longId);
      expect(messages).toHaveLength(1);
    });

    it('should handle unicode content', async () => {
      const unicodeContent = 'Hello 世界 🌍 مرحبا';
      await history.addUserMessage('conv-1', unicodeContent);
      const messages = await history.getHistory('conv-1');
      expect(messages[0].content).toBe(unicodeContent);
    });
  });
});

describe('ConversationHistory API', () => {
  describe('constructor variants', () => {
    it('should support string shorthand for SQLite path', () => {
      // This would fail at runtime without better-sqlite3, but tests the API
      try {
        const history = new ConversationHistory('/tmp/test.db');
        // If better-sqlite3 is available, this works
        expect(history).toBeDefined();
      } catch (e) {
        // Expected without better-sqlite3 - tests that API accepts string
        expect((e as Error).message).toContain('better-sqlite3');
      }
    });

    it('should support options object with path', () => {
      try {
        const history = new ConversationHistory({ path: '/tmp/test.db', maxMessages: 50 });
        expect(history).toBeDefined();
      } catch (e) {
        expect((e as Error).message).toContain('better-sqlite3');
      }
    });

    it('should support in-memory mode with no args', () => {
      const history = new ConversationHistory();
      expect(history).toBeDefined();
    });

    it('should support in-memory mode with options but no path', () => {
      const history = new ConversationHistory({ maxMessages: 10 });
      expect(history).toBeDefined();
    });
  });
});
