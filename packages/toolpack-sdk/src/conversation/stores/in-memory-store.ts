import type { ConversationStore, StoredMessage, GetOptions, ConversationSearchOptions } from '../types.js';
import { LRUCache } from '../../utils/lru.js';

export interface InMemoryConversationStoreConfig {
  /** Maximum conversations to keep in memory. Default: 500. */
  maxConversations?: number;
  /** Maximum messages per conversation. Default: 500. */
  maxMessagesPerConversation?: number;
}

/**
 * In-memory implementation of `ConversationStore`.
 *
 * Good for single-process deployments, local development, and tests.
 * Memory is bounded by `maxConversations × maxMessagesPerConversation`.
 *
 * **Not suitable for multi-process or serverless deployments** — each
 * process has its own isolated store. For those environments, implement
 * `ConversationStore` against a shared database.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly lru: LRUCache<string, StoredMessage[]>;
  private readonly maxMessagesPerConversation: number;

  constructor(config: InMemoryConversationStoreConfig = {}) {
    this.lru = new LRUCache<string, StoredMessage[]>(config.maxConversations ?? 500);
    this.maxMessagesPerConversation = config.maxMessagesPerConversation ?? 500;
  }

  async append(message: StoredMessage): Promise<void> {
    let messages = this.lru.get(message.conversationId);

    if (!messages) {
      messages = [];
      this.lru.set(message.conversationId, messages);
    }

    if (messages.some(m => m.id === message.id)) {
      return;
    }

    messages.push(message);
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    if (messages.length > this.maxMessagesPerConversation) {
      messages.splice(0, messages.length - this.maxMessagesPerConversation);
    }
  }

  async get(conversationId: string, options: GetOptions = {}): Promise<StoredMessage[]> {
    const messages = this.lru.get(conversationId) ?? [];
    let result = messages.slice();

    if (options.scope !== undefined) {
      result = result.filter(m => m.scope === options.scope);
    }

    if (options.sinceTimestamp !== undefined) {
      result = result.filter(m => m.timestamp >= options.sinceTimestamp!);
    }

    if (options.participantIds !== undefined && options.participantIds.length > 0) {
      const ids = new Set(options.participantIds);
      result = result.filter(m => ids.has(m.participant.id));
    }

    if (options.limit !== undefined && result.length > options.limit) {
      result = result.slice(result.length - options.limit);
    }

    return result;
  }

  async search(
    conversationId: string,
    query: string,
    options: ConversationSearchOptions = {}
  ): Promise<StoredMessage[]> {
    const messages = this.lru.get(conversationId) ?? [];
    const queryLower = query.toLowerCase();
    const limit = options.limit ?? 10;
    const tokenCap = options.tokenCap ?? 2000;

    const matches = messages
      .filter(m => m.content.toLowerCase().includes(queryLower))
      .slice()
      .reverse();

    const results: StoredMessage[] = [];
    let tokenCount = 0;

    for (const msg of matches) {
      if (results.length >= limit) break;

      const msgTokens = Math.ceil(msg.content.length / 4);
      if (results.length > 0 && tokenCount + msgTokens > tokenCap) break;

      results.push(msg);
      tokenCount += msgTokens;
    }

    return results;
  }

  async deleteMessages(conversationId: string, ids: string[]): Promise<void> {
    const messages = this.lru.get(conversationId);
    if (!messages || ids.length === 0) return;

    const idSet = new Set(ids);
    const kept = messages.filter(m => !idSet.has(m.id));
    this.lru.set(conversationId, kept);
  }

  clearConversation(conversationId: string): void {
    this.lru.set(conversationId, []);
  }

  get conversationCount(): number {
    return this.lru.size;
  }
}
