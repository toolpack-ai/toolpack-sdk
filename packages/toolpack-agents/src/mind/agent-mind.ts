import type { KnowledgeProvider } from '@toolpack-sdk/knowledge';
import type { RequestToolDefinition } from 'toolpack-sdk';
import { MindStore } from './store.js';
import { DraftBuffer } from './draft-buffer.js';
import { buildMindTools } from './tools.js';
import { assemble } from './assembler.js';
import type { AgentMindConfig, ResolvedMindConfig } from './types.js';

const DEFAULT_TOKEN_BUDGET = 300;
const DEFAULT_RECENCY_WINDOW_DAYS = 7;
const DEFAULT_MAX_GOALS = 10;
const DEFAULT_MAX_PINNED_REFLECTIONS = 10;
const DEFAULT_DEDUP_THRESHOLD = 0.85;
const DEFAULT_RETRIEVAL_THRESHOLD = 0.35;
const DEFAULT_BELIEF_TTL = '30d';
const MAX_GOALS_CEILING = 10;
const MAX_PINNED_CEILING = 10;

export interface RunContext {
  /** The assembled header string to prepend to the system prompt (empty string if no content). */
  mindHeader: string;
  /** The 7 mind tool definitions to add to requestTools. */
  tools: RequestToolDefinition[];
  /** Call this at run completion. Pass isError=true on crash. */
  flush: (isError: boolean) => Promise<void>;
}

/**
 * AgentMind is the cognitive layer coordinator.
 * One instance lives for the lifetime of the agent (lazily created in BaseAgent).
 * A fresh DraftBuffer is created per run() call via createRunContext().
 */
export class AgentMind {
  private constructor(
    private readonly store: MindStore,
    private readonly config: ResolvedMindConfig,
  ) {}

  /**
   * Create and initialise an AgentMind instance.
   * Lazily creates the PersistentKnowledgeProvider when no custom provider is given.
   */
  static async create(agentName: string, options: AgentMindConfig): Promise<AgentMind> {
    let provider: KnowledgeProvider;

    if (options.provider) {
      provider = options.provider;
    } else {
      // Dynamically import PersistentKnowledgeProvider to keep it optional at module load time
      const { PersistentKnowledgeProvider } = await import('@toolpack-sdk/knowledge');
      const namespace = options.namespace ?? `mind/${agentName}`;
      provider = new PersistentKnowledgeProvider({ namespace });
    }

    const config = resolveConfig(agentName, options);
    const store = new MindStore(provider, options.embedder);
    await store.initialize();

    return new AgentMind(store, config);
  }

  /**
   * Called once at the start of each run() to:
   * 1. Assemble the current header from committed store state.
   * 2. Create a fresh per-run DraftBuffer.
   * 3. Build the 7 mind tool definitions bound to that buffer.
   * 4. Return a flush closure for the run's lifecycle hooks.
   *
   * Throws if the store read fails — callers must not proceed with an empty header
   * because pinned safety rules may be missing.
   */
  async createRunContext(): Promise<RunContext> {
    // Read committed goal count and pinned reflection count for cap checks in the draft buffer.
    const [committedGoalCount, committedPinnedCount, mindHeader] = await Promise.all([
      this.store.getActiveGoalCount(),
      this.store.getPinnedReflectionCount(),
      assemble(this.store, this.config),
    ]);

    const draftBuffer = new DraftBuffer(
      this.store,
      this.config.deduplicationThreshold,
      this.config.maxGoals,
      this.config.maxPinnedReflections,
      committedGoalCount,
      committedPinnedCount,
    );

    const tools = buildMindTools(this.store, draftBuffer, this.config);

    const flush = async (isError: boolean): Promise<void> => {
      if (isError) {
        await draftBuffer.flushOnError();
      } else {
        await draftBuffer.flushClean();
      }
    };

    return { mindHeader, tools, flush };
  }

  async close(): Promise<void> {
    if (this.store) {
      // Provider close is optional per KnowledgeProvider interface
      await Promise.resolve();
    }
  }
}

function resolveConfig(agentName: string, options: AgentMindConfig): ResolvedMindConfig {
  const maxGoals = Math.min(options.maxGoals ?? DEFAULT_MAX_GOALS, MAX_GOALS_CEILING);
  const maxPinnedReflections = Math.min(
    options.maxPinnedReflections ?? DEFAULT_MAX_PINNED_REFLECTIONS,
    MAX_PINNED_CEILING,
  );

  return {
    tokenBudget: options.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    recencyWindowDays: options.recencyWindowDays ?? DEFAULT_RECENCY_WINDOW_DAYS,
    maxGoals,
    maxPinnedReflections,
    deduplicationThreshold: options.deduplicationThreshold ?? DEFAULT_DEDUP_THRESHOLD,
    retrievalThreshold: options.retrievalThreshold ?? DEFAULT_RETRIEVAL_THRESHOLD,
    ttlDefaults: {
      belief: options.ttlDefaults?.belief ?? DEFAULT_BELIEF_TTL,
      reflection: options.ttlDefaults?.reflection,
    },
    namespace: options.namespace ?? `mind/${agentName}`,
  };
}
