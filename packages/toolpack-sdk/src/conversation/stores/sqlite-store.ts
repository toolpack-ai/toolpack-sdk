import type { ConversationStore, StoredMessage, GetOptions, ConversationSearchOptions } from '../types.js';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface SQLiteConversationStoreConfig {
  dbPath?: string;
  maxMessagesPerConversation?: number;
  enableWAL?: boolean;
  useFTS?: boolean;
}

function defaultDbPath(): string {
  const base = path.join(process.cwd(), '.toolpack', 'db', 'conversation');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'conversation.sqlite');
}

export class SQLiteConversationStore implements ConversationStore {
  private readonly db: Database.Database;
  private readonly maxMessagesPerConversation: number;
  private readonly useFTS: boolean;

  constructor(config: SQLiteConversationStoreConfig = {}) {
    const dbPath = config.dbPath ?? defaultDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);

    if (config.enableWAL !== false) {
      try { this.db.pragma('journal_mode = WAL'); } catch { /* ignore */ }
      try { this.db.pragma('synchronous = NORMAL'); } catch { /* ignore */ }
    }

    this.useFTS = config.useFTS === true;
    this.maxMessagesPerConversation = config.maxMessagesPerConversation ?? 500;

    this.initSchema();
  }

  private initSchema() {
    const createTable = `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        participant_kind TEXT,
        participant_id TEXT,
        participant_display_name TEXT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        scope TEXT NOT NULL,
        metadata TEXT,
        PRIMARY KEY (conversation_id, id)
      )`;

    this.db.exec(createTable);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv_ts ON messages (conversation_id, timestamp)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv_scope_ts ON messages (conversation_id, scope, timestamp)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv_participant_ts ON messages (conversation_id, participant_id, timestamp)');

    if (this.useFTS) {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(doc_key UNINDEXED, content, tokenize = 'unicode61')`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_fts_key ON messages_fts (doc_key)`);
    }
  }

  async append(message: StoredMessage): Promise<void> {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO messages (
         id, conversation_id, participant_kind, participant_id, participant_display_name,
         content, timestamp, scope, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const meta = message.metadata ? JSON.stringify(message.metadata) : null;

    const result = insert.run(
      message.id,
      message.conversationId,
      message.participant.kind,
      message.participant.id,
      message.participant.displayName ?? null,
      message.content,
      message.timestamp,
      message.scope,
      meta
    );

    if (this.useFTS && result.changes > 0) {
      const docKey = `${message.conversationId}:${message.id}`;
      const upsertFts = this.db.prepare('INSERT INTO messages_fts (doc_key, content) VALUES (?, ?)');
      upsertFts.run(docKey, message.content);
    }

    if (this.maxMessagesPerConversation > 0) {
      const countStmt = this.db.prepare('SELECT COUNT(1) as c FROM messages WHERE conversation_id = ?');
      const row = countStmt.get(message.conversationId) as { c: number } | undefined;
      const count = row?.c ?? 0;
      if (count > this.maxMessagesPerConversation) {
        const toPrune = count - this.maxMessagesPerConversation;
        const selectOld = this.db.prepare(
          'SELECT id FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?'
        );
        const oldIds = (selectOld.all(message.conversationId, toPrune) as { id: string }[]).map(r => r.id);
        if (oldIds.length > 0) {
          const placeholders = oldIds.map(() => '?').join(',');
          const del = this.db.prepare(`DELETE FROM messages WHERE conversation_id = ? AND id IN (${placeholders})`);
          del.run(message.conversationId, ...oldIds);
          if (this.useFTS) {
            const docKeys = oldIds.map(id => `${message.conversationId}:${id}`);
            const dkPlace = docKeys.map(() => '?').join(',');
            const delFts = this.db.prepare(`DELETE FROM messages_fts WHERE doc_key IN (${dkPlace})`);
            delFts.run(...docKeys);
          }
        }
      }
    }
  }

  async get(conversationId: string, options: GetOptions = {}): Promise<StoredMessage[]> {
    const clauses: string[] = ['conversation_id = ?'];
    const params: any[] = [conversationId];

    if (options.scope !== undefined) {
      clauses.push('scope = ?');
      params.push(options.scope);
    }

    if (options.sinceTimestamp !== undefined) {
      clauses.push('timestamp >= ?');
      params.push(options.sinceTimestamp);
    }

    if (options.participantIds && options.participantIds.length > 0) {
      const placeholders = options.participantIds.map(() => '?').join(',');
      clauses.push(`participant_id IN (${placeholders})`);
      params.push(...options.participantIds);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sqlAsc = `SELECT id, conversation_id, participant_kind, participant_id, participant_display_name, content, timestamp, scope, metadata FROM messages ${where} ORDER BY timestamp ASC`;
    const rows = this.db.prepare(sqlAsc).all(params) as any[];

    let result = rows.map(r => this.rowToMessage(r));

    if (options.limit !== undefined && result.length > options.limit) {
      result = result.slice(result.length - options.limit);
    }

    return result;
  }

  async search(conversationId: string, query: string, options: ConversationSearchOptions = {}): Promise<StoredMessage[]> {
    const limit = options.limit ?? 10;
    const tokenCap = options.tokenCap ?? 2000;

    let rows: any[] = [];
    if (this.useFTS) {
      const sql = `
        SELECT m.id, m.conversation_id, m.participant_kind, m.participant_id, m.participant_display_name,
               m.content, m.timestamp, m.scope, m.metadata
        FROM messages m
        JOIN messages_fts f ON f.doc_key = (m.conversation_id || ':' || m.id)
        WHERE m.conversation_id = ? AND f.content MATCH ?
        ORDER BY m.timestamp DESC`;
      rows = this.db.prepare(sql).all(conversationId, query) as any[];
    } else {
      const sql = `
        SELECT id, conversation_id, participant_kind, participant_id, participant_display_name,
               content, timestamp, scope, metadata
        FROM messages
        WHERE conversation_id = ? AND content LIKE ? COLLATE NOCASE
        ORDER BY timestamp DESC`;
      rows = this.db.prepare(sql).all(conversationId, `%${query}%`) as any[];
    }

    const messages = rows.map(r => this.rowToMessage(r));

    const results: StoredMessage[] = [];
    let tokenCount = 0;

    for (const msg of messages) {
      if (results.length >= limit) break;
      const msgTokens = Math.ceil(msg.content.length / 4);
      if (results.length > 0 && tokenCount + msgTokens > tokenCap) break;
      results.push(msg);
      tokenCount += msgTokens;
    }

    return results;
  }

  async deleteMessages(conversationId: string, ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    const del = this.db.prepare(`DELETE FROM messages WHERE conversation_id = ? AND id IN (${placeholders})`);
    del.run(conversationId, ...ids);
    if (this.useFTS) {
      const docKeys = ids.map(id => `${conversationId}:${id}`);
      const dkPlace = docKeys.map(() => '?').join(',');
      const delFts = this.db.prepare(`DELETE FROM messages_fts WHERE doc_key IN (${dkPlace})`);
      delFts.run(...docKeys);
    }
  }

  clearConversation(conversationId: string): void {
    if (this.useFTS) {
      const delFtsByConv = this.db.prepare(`DELETE FROM messages_fts WHERE doc_key LIKE ?`);
      delFtsByConv.run(`${conversationId}:%`);
    }
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  }

  private rowToMessage(r: any): StoredMessage {
    return {
      id: r.id,
      conversationId: r.conversation_id,
      participant: {
        kind: r.participant_kind,
        id: r.participant_id,
        displayName: r.participant_display_name ?? undefined,
      },
      content: r.content,
      timestamp: r.timestamp,
      scope: r.scope,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    };
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}
