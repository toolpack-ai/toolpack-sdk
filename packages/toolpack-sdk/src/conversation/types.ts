import type { Participant } from './interfaces/participant.js';

/**
 * Coarse scope of a stored message.
 *
 * - `thread`  — a reply inside a specific thread (Slack thread, email thread)
 * - `channel` — top-level message in a channel / group chat
 * - `dm`      — direct / private message between two participants
 */
export type ConversationScope = 'thread' | 'channel' | 'dm';

/**
 * A single stored message in conversation history.
 *
 * This is the canonical storage shape. It is deliberately richer than
 * the LLM's role-based format — the prompt assembler projects it into
 * whatever the provider expects at render time.
 */
export interface StoredMessage {
  /** Stable, unique message id. Used for dedup at capture time. */
  id: string;

  /**
   * Conversation key. Identifies the thread / DM / channel this message
   * belongs to.
   */
  conversationId: string;

  /** Who sent this message. */
  participant: Participant;

  /** Plain-text content of the message. */
  content: string;

  /** ISO 8601 timestamp of when the message was received/sent. */
  timestamp: string;

  /** Coarse scope used by the assembler to filter by context type. */
  scope: ConversationScope;

  metadata?: {
    /** Platform channel type, e.g. 'im' for Slack DMs, 'private' for Telegram DMs. */
    channelType?: string;
    /** Thread timestamp / id within a channel (e.g. Slack thread_ts). */
    threadId?: string;
    /** Platform-specific message id for dedup and linking. */
    messageId?: string;
    /** Participant ids explicitly @-mentioned in this message. */
    mentions?: string[];
    /** Whether this message is a rolling summary replacing older turns. */
    isSummary?: boolean;
    /** Human-readable channel or group name (e.g. '#general', 'Project Kore'). */
    channelName?: string;
    /** Platform-specific channel identifier (e.g. Slack 'C12345', Telegram chat id). */
    channelId?: string;
  };
}

/** Options for retrieving messages from the store. */
export interface GetOptions {
  /** Filter to a specific scope within the conversation. */
  scope?: ConversationScope;

  /** Only return messages at or after this ISO timestamp. */
  sinceTimestamp?: string;

  /** Maximum number of messages to return (most recent N). */
  limit?: number;

  /**
   * When set, only return messages whose `participant.id` is in this set.
   * Used by the assembler's addressed-only mode.
   */
  participantIds?: string[];
}

/** Options for the conversation search tool. */
export interface ConversationSearchOptions {
  /** Maximum number of results to return. Default: 10. */
  limit?: number;

  /**
   * Rough token cap for total search results.
   * The store truncates content to fit within this budget.
   * Default: 2000.
   */
  tokenCap?: number;
}

/** Options for the prompt assembler (used by toolpack-agents). */
export interface AssemblerOptions {
  scope?: ConversationScope;
  addressedOnlyMode?: boolean;
  tokenBudget?: number;
  rollingSummaryThreshold?: number;
  timeWindowMinutes?: number;
  maxTurnsToLoad?: number;
  agentAliases?: string[];
}

/** A single message entry in the assembled prompt, ready to send to the LLM. */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The output of the prompt assembler. */
export interface AssembledPrompt {
  messages: PromptMessage[];
  estimatedTokens: number;
  turnsLoaded: number;
  hasSummary: boolean;
}

/**
 * Interface for conversation history storage.
 *
 * Implementations must be:
 * - **Append-only safe**: `append()` must be idempotent on duplicate `id`.
 * - **Ordered**: `get()` returns messages in ascending timestamp order.
 * - **Scope-aware**: `get()` must respect `options.scope` when provided.
 */
export interface ConversationStore {
  append(message: StoredMessage): Promise<void>;
  get(conversationId: string, options?: GetOptions): Promise<StoredMessage[]>;
  search(conversationId: string, query: string, options?: ConversationSearchOptions): Promise<StoredMessage[]>;
  deleteMessages(conversationId: string, ids: string[]): Promise<void>;
}
