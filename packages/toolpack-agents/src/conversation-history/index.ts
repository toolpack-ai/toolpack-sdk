/**
 * Conversation history for agents.
 * Simple, zero-config conversation storage. Auto-detects SQLite vs in-memory.
 *
 * @example
 * ```typescript
 * // Development - in-memory (fast, lost on restart)
 * const history = new ConversationHistory();
 *
 * // Production - SQLite (persists across restarts)
 * const history = new ConversationHistory('./conversations.db');
 *
 * // With custom max messages
 * const history = new ConversationHistory({ path: './history.db', maxMessages: 50 });
 * ```
 */

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  agentName?: string;
}

export interface ConversationHistoryOptions {
  /** Path to SQLite database file (omit for in-memory) */
  path?: string;
  /** Maximum messages per conversation (default: 20) */
  maxMessages?: number;
  /** Number of recent messages to include in AI context (default: 10) */
  limit?: number;
  /** Enable full-text search index for conversation search (SQLite only, default: false) */
  searchIndex?: boolean;
}

/** Tool definition for conversation search */
export interface ConversationSearchTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: {
      query: {
        type: 'string';
        description: string;
      };
      limit?: {
        type: 'number';
        description: string;
        default?: number;
      };
    };
    required: string[];
  };
  execute: (params: { query: string; limit?: number }) => Promise<{
    results: Array<{
      role: string;
      content: string;
      timestamp: string;
      agentName?: string;
    }>;
    count: number;
  }>;
}

/**
 * Unified conversation history manager.
 * Automatically uses SQLite if path provided, otherwise in-memory.
 */
export class ConversationHistory {
  private mode!: 'memory' | 'sqlite';
  private memory!: Map<string, ConversationMessage[]>;
  private db: any;
  private maxMessages!: number;
  private limit: number;
  private searchIndex: boolean;

  constructor(options?: string | ConversationHistoryOptions) {
    // Handle string shorthand: new ConversationHistory('./path.db')
    if (typeof options === 'string') {
      this.limit = 10;
      this.searchIndex = false;
      this.initSQLite(options, false);
      this.maxMessages = 20;
    }
    // Handle options object with path (SQLite mode)
    else if (options?.path) {
      this.limit = options.limit || 10;
      this.searchIndex = options.searchIndex || false;
      this.initSQLite(options.path, this.searchIndex);
      this.maxMessages = options.maxMessages || 20;
    }
    // In-memory mode
    else {
      this.mode = 'memory';
      this.memory = new Map();
      this.limit = options?.limit || 10;
      this.searchIndex = false;
      this.maxMessages = options?.maxMessages || 20;
    }
  }

  private initSQLite(path: string, enableSearch: boolean): void {
    this.mode = 'sqlite';
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3') as typeof import('better-sqlite3');
      this.db = new Database(path);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          agent_name TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_conv ON messages(conversation_id);
      `);
      
      // Create FTS5 virtual table for search if enabled
      if (enableSearch) {
        try {
          this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
              content,
              content_rowid='id'
            );
          `);
        } catch {
          // FTS5 not available - disable search but continue with normal functionality
          this.searchIndex = false;
        }
      }
    } catch {
      throw new Error('SQLite mode requires better-sqlite3. Install: npm install better-sqlite3');
    }
  }

  /** Get conversation history (last N messages) */
  async getHistory(conversationId: string, limit?: number): Promise<ConversationMessage[]> {
    const requestedLimit = limit ?? this.limit;
    const effectiveLimit = Math.min(requestedLimit, this.maxMessages);

    if (this.mode === 'memory') {
      const msgs = this.memory.get(conversationId) || [];
      return msgs.slice(-effectiveLimit);
    }

    const rows = this.db.prepare(
      `SELECT role, content, timestamp, agent_name
       FROM messages WHERE conversation_id = ?
       ORDER BY id DESC LIMIT ?`
    ).all(conversationId, effectiveLimit);

    // Map rows to ConversationMessage format
    return rows.reverse().map((row: { role: string; content: string; timestamp: string; agent_name: string | null }) => ({
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      timestamp: row.timestamp,
      agentName: row.agent_name || undefined,
    }));
  }

  /** Add a user message */
  async addUserMessage(conversationId: string, content: string, agentName?: string): Promise<void> {
    await this.add(conversationId, 'user', content, agentName);
  }

  /** Add an assistant message */
  async addAssistantMessage(conversationId: string, content: string, agentName?: string): Promise<void> {
    await this.add(conversationId, 'assistant', content, agentName);
  }

  /** Add a system message */
  async addSystemMessage(conversationId: string, content: string, agentName?: string): Promise<void> {
    await this.add(conversationId, 'system', content, agentName);
  }

  private async add(conversationId: string, role: 'user' | 'assistant' | 'system', content: string, agentName?: string): Promise<void> {
    const msg: ConversationMessage = {
      role,
      content,
      timestamp: new Date().toISOString(),
      agentName,
    };

    if (this.mode === 'memory') {
      const msgs = this.memory.get(conversationId) || [];
      msgs.push(msg);
      // Trim to max (remove oldest)
      while (msgs.length > this.maxMessages) msgs.shift();
      this.memory.set(conversationId, msgs);
    } else {
      const result = this.db.prepare(
        `INSERT INTO messages (conversation_id, role, content, timestamp, agent_name)
         VALUES (?, ?, ?, ?, ?)`
      ).run(conversationId, role, content, msg.timestamp, agentName || null);
      
      // Sync to FTS index if enabled
      if (this.searchIndex) {
        this.db.prepare(
          'INSERT INTO messages_fts(rowid, content) VALUES (?, ?)'
        ).run(result.lastInsertRowid, content);
      }

      // Trim old messages only when count exceeds maxMessages
      const count = this.db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?'
      ).get(conversationId).count;
      
      if (count > this.maxMessages) {
        // Calculate how many to delete
        const toDelete = count - this.maxMessages;
        
        // Find IDs of oldest messages to delete
        const idsToDelete = this.db.prepare(
          `SELECT id FROM messages 
           WHERE conversation_id = ? 
           ORDER BY id ASC 
           LIMIT ?`
        ).all(conversationId, toDelete);
        
        if (idsToDelete.length > 0) {
          const idList = idsToDelete.map((row: { id: number }) => row.id).join(',');
          
          // Delete from main table
          this.db.prepare(`DELETE FROM messages WHERE id IN (${idList})`).run();
          
          // Delete from FTS index if enabled
          if (this.searchIndex) {
            this.db.prepare(`DELETE FROM messages_fts WHERE rowid IN (${idList})`).run();
          }
        }
      }
    }
  }

  /** Clear a conversation */
  async clear(conversationId: string): Promise<void> {
    if (this.mode === 'memory') {
      this.memory.delete(conversationId);
    } else {
      // If FTS is enabled, find and delete index entries first
      if (this.searchIndex) {
        const ids = this.db.prepare(
          'SELECT id FROM messages WHERE conversation_id = ?'
        ).all(conversationId);
        
        if (ids.length > 0) {
          const idList = ids.map((row: { id: number }) => row.id).join(',');
          this.db.prepare(`DELETE FROM messages_fts WHERE rowid IN (${idList})`).run();
        }
      }
      
      // Delete from main table
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    }
  }

  /** 
   * Get the number of messages in a conversation.
   * Useful for debugging and monitoring.
   */
  async count(conversationId: string): Promise<number> {
    if (this.mode === 'memory') {
      return this.memory.get(conversationId)?.length || 0;
    }
    const result = this.db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?'
    ).get(conversationId);
    return result?.count || 0;
  }

  /** 
   * Check if using persistent storage (SQLite).
   * Returns true for SQLite mode, false for in-memory.
   */
  get isPersistent(): boolean {
    return this.mode === 'sqlite';
  }

  /**
   * Get the configured limit for recent messages sent to AI.
   */
  getHistoryLimit(): number {
    return this.limit;
  }

  /**
   * Check if full-text search is enabled and available.
   * Note: This may return false if FTS5 is not supported by the SQLite build,
   * even if searchIndex was set to true in options.
   */
  get isSearchEnabled(): boolean {
    return this.searchIndex;
  }

  /**
   * Check if FTS5 search is available on this system.
   * Use this to verify search capability before calling search().
   */
  isSearchAvailable(): boolean {
    if (this.mode === 'memory') return true; // In-memory always has text search
    return this.searchIndex; // SQLite only if FTS5 was successfully initialized
  }

  /** 
   * Search conversation history using full-text search (BM25).
   * Returns most relevant messages matching the query.
   * Only available in SQLite mode with searchIndex enabled.
   * 
   * @param conversationId - The conversation to search
   * @param query - Search query (keywords/phrases)
   * @param limit - Maximum results (default: 5)
   */
  async search(conversationId: string, query: string, limit = 5): Promise<ConversationMessage[]> {
    if (this.mode === 'memory') {
      // Simple text search for in-memory mode
      const msgs = this.memory.get(conversationId) || [];
      const lowerQuery = query.toLowerCase();
      return msgs
        .filter(msg => msg.content.toLowerCase().includes(lowerQuery))
        .slice(0, limit);
    }

    if (!this.searchIndex) {
      throw new Error('Search not enabled. Create ConversationHistory with searchIndex: true');
    }

    try {
      const rows = this.db.prepare(
        `SELECT m.role, m.content, m.timestamp, m.agent_name
         FROM messages m
         JOIN messages_fts fts ON m.id = fts.rowid
         WHERE m.conversation_id = ?
           AND messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      ).all(conversationId, query, limit);

      return rows.map((row: { role: string; content: string; timestamp: string; agent_name: string | null }) => ({
        role: row.role as 'user' | 'assistant' | 'system',
        content: row.content,
        timestamp: row.timestamp,
        agentName: row.agent_name || undefined,
      }));
    } catch (error) {
      // Handle FTS query errors (e.g., malformed queries)
      // Return empty array instead of crashing
      return [];
    }
  }

  /**
   * Export as a tool for AI agents to search conversation history.
   * The AI can call this tool when it needs to find information from earlier in the conversation.
   * 
   * @param conversationId - The conversation ID to scope searches to
   * @returns Tool definition compatible with Toolpack SDK
   */
  toTool(conversationId: string) {
    return {
      name: 'conversation_search',
      description: 'Search past conversation history for specific information, questions, or topics mentioned earlier. Use this when the user refers to something from earlier in the conversation that is not in the recent context.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string' as const,
            description: 'Search query with keywords or phrases to find in conversation history. Be specific - use the exact words or concepts the user mentioned.',
          },
          limit: {
            type: 'number' as const,
            description: 'Maximum number of matching messages to return (default: 5).',
            default: 5,
          },
        },
        required: ['query'],
      },
      execute: async (params: { query: string; limit?: number }) => {
        const results = await this.search(conversationId, params.query, params.limit || 5);
        return {
          results: results.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            agentName: msg.agentName,
          })),
          count: results.length,
        };
      },
    };
  }

  /** Close SQLite connection (no-op for memory) */
  close(): void {
    if (this.mode === 'sqlite') {
      this.db.close();
    }
  }
}
