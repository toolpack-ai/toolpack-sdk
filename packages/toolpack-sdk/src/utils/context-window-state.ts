import type { ContextWindowState, ContextWindowConfig } from '../types/index.js';

/**
 * Manages per-conversation context window state
 * Tracks token usage, pruning operations, and summarization events
 */
export class ContextWindowStateManager {
  private states: Map<string, ContextWindowState> = new Map();
  private config: ContextWindowConfig;
  private maxTokens: number = 100000;

  constructor(config: ContextWindowConfig) {
    this.config = config;
  }

  /**
   * Gets or creates state for a conversation
   */
  getOrCreateState(conversationId: string): ContextWindowState {
    if (!this.states.has(conversationId)) {
      this.states.set(conversationId, {
        conversationId,
        estimatedTokens: 0,
        lastUpdated: Date.now(),
        pruneCount: 0,
        lastPrunedAt: undefined,
        warningsSent: 0,
        summarizationCount: 0,
      });
    }

    return this.states.get(conversationId)!;
  }

  /**
   * Updates token count for a conversation
   */
  updateTokenCount(conversationId: string, tokens: number): ContextWindowState {
    const state = this.getOrCreateState(conversationId);
    state.estimatedTokens = tokens;
    state.lastUpdated = Date.now();
    return state;
  }

  /**
   * Increments pruning operation counter
   */
  recordPruneOperation(conversationId: string, tokensRecovered: number): ContextWindowState {
    const state = this.getOrCreateState(conversationId);
    state.pruneCount++;
    state.lastPrunedAt = Date.now();
    state.estimatedTokens = Math.max(0, state.estimatedTokens - tokensRecovered);
    state.lastUpdated = Date.now();
    return state;
  }

  /**
   * Increments warning count
   */
  recordWarning(conversationId: string): ContextWindowState {
    const state = this.getOrCreateState(conversationId);
    state.warningsSent++;
    state.lastUpdated = Date.now();
    return state;
  }

  /**
   * Increments summarization count
   */
  recordSummarization(conversationId: string, tokensSaved: number): ContextWindowState {
    const state = this.getOrCreateState(conversationId);
    state.summarizationCount++;
    state.estimatedTokens = Math.max(0, state.estimatedTokens - tokensSaved);
    state.lastUpdated = Date.now();
    return state;
  }

  /**
   * Gets the current state for a conversation
   */
  getState(conversationId: string): ContextWindowState | undefined {
    return this.states.get(conversationId);
  }

  /**
   * Gets all tracked conversation states
   */
  getAllStates(): ContextWindowState[] {
    return Array.from(this.states.values());
  }

  /**
   * Deletes state for a conversation
   */
  deleteState(conversationId: string): boolean {
    return this.states.delete(conversationId);
  }

  /**
   * Clears all states
   */
  clearAllStates(): void {
    this.states.clear();
  }

  /**
   * Gets statistics for a conversation
   */
  getStatistics(conversationId: string): {
    conversationId: string;
    currentTokens: number;
    pruneCount: number;
    summarizationCount: number;
    warningsSent: number;
    lastActivity: Date | undefined;
    contextWindowPercentage: number;
  } | null {
    const state = this.states.get(conversationId);
    if (!state) {
      return null;
    }

    const contextWindowLimit = this.config.pruneThreshold || 100000;
    const contextWindowPercentage = Math.round((state.estimatedTokens / contextWindowLimit) * 100);

    return {
      conversationId,
      currentTokens: state.estimatedTokens,
      pruneCount: state.pruneCount,
      summarizationCount: state.summarizationCount,
      warningsSent: state.warningsSent,
      lastActivity: new Date(state.lastUpdated),
      contextWindowPercentage,
    };
  }

  /**
   * Gets conversations exceeding a threshold
   */
  getExceedingThreshold(threshold?: number): ContextWindowState[] {
    const limit = threshold || (this.maxTokens * (this.config.pruneThreshold || 85) / 100);
    return Array.from(this.states.values()).filter((state) => state.estimatedTokens > limit);
  }

  /**
   * Gets conversations at risk (approaching threshold)
   */
  getAtRiskConversations(riskPercentage: number = 80): ContextWindowState[] {
    const limit = this.maxTokens;
    const riskThreshold = (limit * riskPercentage) / 100;
    return Array.from(this.states.values()).filter((state) => state.estimatedTokens > riskThreshold && state.estimatedTokens <= limit);
  }

  /**
   * Generates a report of all conversation states
   */
  generateReport(): string {
    const states = this.getAllStates();
    if (states.length === 0) {
      return 'No conversations tracked yet.';
    }

    const limit = this.config.pruneThreshold || 100000;
    const lines: string[] = [
      'Context Window State Report',
      '==========================',
      `Report Generated: ${new Date().toISOString()}`,
      `Context Window Limit: ${limit} tokens`,
      `Total Conversations: ${states.length}`,
      '',
    ];

    // Summary statistics
    const totalTokens = states.reduce((sum, s) => sum + s.estimatedTokens, 0);
    const totalPrunes = states.reduce((sum, s) => sum + s.pruneCount, 0);
    const totalSummarizations = states.reduce((sum, s) => sum + s.summarizationCount, 0);
    const avgTokens = Math.round(totalTokens / states.length);

    lines.push('Summary:');
    lines.push(`- Total tokens across all conversations: ${totalTokens}`);
    lines.push(`- Average tokens per conversation: ${avgTokens}`);
    lines.push(`- Total prune operations: ${totalPrunes}`);
    lines.push(`- Total summarizations: ${totalSummarizations}`);
    lines.push('');

    // At-risk conversations
    const atRisk = this.getAtRiskConversations();
    if (atRisk.length > 0) {
      lines.push(`At-Risk Conversations (80%+ threshold): ${atRisk.length}`);
      atRisk.forEach((state) => {
        const pct = Math.round((state.estimatedTokens / limit) * 100);
        lines.push(`- ${state.conversationId}: ${state.estimatedTokens}/${limit} tokens (${pct}%)`);
      });
      lines.push('');
    }

    // Exceeded conversations
    const exceeded = this.getExceedingThreshold();
    if (exceeded.length > 0) {
      lines.push(`Exceeded Conversations: ${exceeded.length}`);
      exceeded.forEach((state) => {
        const over = state.estimatedTokens - limit;
        lines.push(`- ${state.conversationId}: ${state.estimatedTokens}/${limit} tokens (+${over} over)`);
      });
      lines.push('');
    }

    // Most active conversations
    lines.push('Most Active Conversations (by operations):');
    const sorted = [...states].sort((a, b) => {
      const aOps = a.pruneCount + a.summarizationCount;
      const bOps = b.pruneCount + b.summarizationCount;
      return bOps - aOps;
    });

    sorted.slice(0, 5).forEach((state) => {
      const ops = state.pruneCount + state.summarizationCount;
      lines.push(`- ${state.conversationId}: ${state.pruneCount} prunes, ${state.summarizationCount} summarizations (${ops} operations)`);
    });

    return lines.join('\n');
  }

  /**
   * Exports state as JSON for persistence
   */
  export(): Record<string, ContextWindowState> {
    const result: Record<string, ContextWindowState> = {};
    for (const [key, value] of this.states.entries()) {
      result[key] = {
        ...value,
        lastUpdated: value.lastUpdated,
        lastPrunedAt: value.lastPrunedAt,
      };
    }
    return result;
  }

  /**
   * Imports state from JSON
   */
  import(data: Record<string, ContextWindowState>): void {
    for (const [key, value] of Object.entries(data)) {
      this.states.set(key, {
        ...value,
        lastUpdated: typeof value.lastUpdated === 'number' ? value.lastUpdated : new Date(value.lastUpdated).getTime(),
        lastPrunedAt: value.lastPrunedAt && typeof value.lastPrunedAt !== 'number' ? new Date(value.lastPrunedAt).getTime() : value.lastPrunedAt,
      });
    }
  }

  /**
   * Prunes old conversations (no activity in specified time)
   */
  pruneInactiveConversations(inactivityMinutes: number = 60): string[] {
    const cutoffTime = Date.now() - inactivityMinutes * 60 * 1000;
    const toDelete: string[] = [];

    for (const [conversationId, state] of this.states.entries()) {
      if (state.lastUpdated < cutoffTime) {
        toDelete.push(conversationId);
      }
    }

    toDelete.forEach((id) => this.states.delete(id));
    return toDelete;
  }

  /**
   * Gets memory usage of the state manager
   */
  getMemoryUsage(): {
    conversationCount: number;
    approximateByteSize: number;
  } {
    const conversationCount = this.states.size;
    // Rough estimation: ~500 bytes per conversation state
    const approximateByteSize = conversationCount * 500;

    return {
      conversationCount,
      approximateByteSize,
    };
  }

  /**
   * Validates state integrity
   */
  validateIntegrity(): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    for (const [conversationId, state] of this.states.entries()) {
      if (!conversationId || typeof conversationId !== 'string') {
        issues.push(`Invalid conversation ID: ${conversationId}`);
      }

      if (state.estimatedTokens < 0) {
        issues.push(`Negative token count for ${conversationId}: ${state.estimatedTokens}`);
      }

      if (state.pruneCount < 0) {
        issues.push(`Negative prune count for ${conversationId}: ${state.pruneCount}`);
      }

      if (state.summarizationCount < 0) {
        issues.push(`Negative summarization count for ${conversationId}: ${state.summarizationCount}`);
      }

      if (state.warningsSent < 0) {
        issues.push(`Negative warning count for ${conversationId}: ${state.warningsSent}`);
      }

      if (typeof state.lastUpdated !== 'number' || state.lastUpdated <= 0) {
        issues.push(`Invalid lastUpdated timestamp for ${conversationId}`);
      }

      if (state.lastPrunedAt !== undefined && (typeof state.lastPrunedAt !== 'number' || state.lastPrunedAt <= 0)) {
        issues.push(`Invalid lastPrunedAt timestamp for ${conversationId}`);
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }
}

/**
 * Creates a new ContextWindowStateManager with the given config
 */
export function createContextWindowStateManager(config: ContextWindowConfig): ContextWindowStateManager {
  return new ContextWindowStateManager(config);
}
