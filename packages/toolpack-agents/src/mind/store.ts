import { randomUUID } from 'crypto';
import type { KnowledgeProvider, Embedder, Chunk, MetadataFilter } from '@toolpack-sdk/knowledge';
import type {
  MindGoal,
  MindBelief,
  MindReflection,
  GoalStatus,
  GoalPriority,
  ConfidenceLevel,
} from './types.js';

// Composite scoring weights per spec
const SEMANTIC_W = 0.6;
const RECENCY_W = 0.2;
const CONFIDENCE_W = 0.2;
const CONFIDENCE_VALUES: Record<ConfidenceLevel, number> = { low: 0.3, medium: 0.6, high: 1.0 };
const HALF_LIFE_DAYS = 30; // recency decay: e^(-t/30)

// All metadata keys are prefixed with _ to avoid collisions
const T = {
  type: '_type',
  status: '_status',
  priority: '_priority',
  tags: '_tags',
  progress: '_progress',
  dueBy: '_dueBy',
  outcome: '_outcome',
  confidence: '_confidence',
  expiresAt: '_expiresAt',
  pinned: '_pinned',
  relatedTo: '_relatedTo',
  error: '_error',
  createdAt: '_createdAt',
  updatedAt: '_updatedAt',
} as const;

export class MindStore {
  // Stable zero vector for goals (no embedding needed; goals use keyword/structured queries)
  private readonly zeroVector: number[];

  constructor(
    private readonly provider: KnowledgeProvider,
    private readonly embedder: Embedder,
  ) {
    this.zeroVector = new Array(embedder.dimensions).fill(0);
  }

  async initialize(): Promise<void> {
    await this.provider.validateDimensions(this.embedder.dimensions);
  }

  // --- Embed ---

  async embed(text: string): Promise<number[]> {
    return this.embedder.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embedder.embedBatch(texts);
  }

  // --- Structured reads (no embedding at call time) ---

  async getActiveGoals(): Promise<MindGoal[]> {
    const chunks = await this._getAllByMeta(c => c[T.type] === 'goal' && c[T.status] === 'active');
    return chunks
      .map(c => this.chunkToGoal(c))
      .sort((a, b) => {
        const pri: Record<GoalPriority, number> = { high: 0, normal: 1, low: 2 };
        const pd = pri[a.priority] - pri[b.priority];
        return pd !== 0 ? pd : a.createdAt - b.createdAt;
      });
  }

  async getActiveGoalCount(): Promise<number> {
    const chunks = await this._getAllByMeta(c => c[T.type] === 'goal' && c[T.status] === 'active');
    return chunks.length;
  }

  async getPinnedReflections(): Promise<MindReflection[]> {
    const chunks = await this._getAllByMeta(
      c => c[T.type] === 'reflection' && c[T.pinned] === true,
    );
    return chunks.map(c => this.chunkToReflection(c));
  }

  async getPinnedReflectionCount(): Promise<number> {
    const chunks = await this._getAllByMeta(
      c => c[T.type] === 'reflection' && c[T.pinned] === true,
    );
    return chunks.length;
  }

  async getHighConfidenceBeliefs(limit: number): Promise<Array<MindBelief & { score: number }>> {
    const now = Date.now();
    const chunks = await this._getAllByMeta(
      c =>
        c[T.type] === 'belief' &&
        c[T.confidence] === 'high' &&
        !c[T.error] &&
        !(c[T.expiresAt] && (c[T.expiresAt] as number) < now),
    );
    return chunks
      .map(c => {
        const belief = this.chunkToBelief(c);
        const ageDays = (now - belief.createdAt) / 86_400_000;
        const recency = Math.exp(-ageDays / HALF_LIFE_DAYS);
        // For assembly we don't have a query vector; use recency + confidence only
        const score = recency * RECENCY_W + CONFIDENCE_VALUES.high * CONFIDENCE_W + SEMANTIC_W;
        return { ...belief, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async getRecentReflections(maxAgeDays: number, limit: number): Promise<MindReflection[]> {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const chunks = await this._getAllByMeta(
      c =>
        c[T.type] === 'reflection' &&
        !c[T.pinned] &&
        !c[T.error] &&
        (c[T.createdAt] as number) >= cutoff,
    );
    return chunks
      .map(c => this.chunkToReflection(c))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  // --- Keyword search (goals) ---

  async keywordSearchGoals(
    text: string,
    options: { limit?: number; status?: GoalStatus; tags?: string[] } = {},
  ): Promise<MindGoal[]> {
    const { limit = 10, status = 'active', tags } = options;
    let goals: MindGoal[];

    if (text.trim() && typeof this.provider.keywordQuery === 'function') {
      const results = await this.provider.keywordQuery(text, {
        limit: limit * 2,
        threshold: 0,
        filter: { [T.type]: 'goal', [T.status]: status },
      });
      goals = results.map(r => this.chunkToGoal(r.chunk));
    } else {
      // Fallback: full scan with substring match
      const statusVal = status;
      const chunks = await this._getAllByMeta(
        c => c[T.type] === 'goal' && c[T.status] === statusVal,
      );
      goals = chunks.map(c => this.chunkToGoal(c));
      if (text.trim()) {
        const lower = text.toLowerCase();
        goals = goals.filter(g => g.description.toLowerCase().includes(lower));
      }
    }

    if (tags?.length) {
      goals = goals.filter(g => tags.every(t => g.tags.includes(t)));
    }

    return goals.slice(0, limit);
  }

  // --- Semantic search (beliefs and reflections) ---

  async queryBeliefs(
    vector: number[],
    options: {
      limit?: number;
      threshold?: number;
      tags?: string[];
      includeExpired?: boolean;
    },
  ): Promise<Array<MindBelief & { score: number }>> {
    const { limit = 10, threshold = 0, tags, includeExpired = false } = options;
    const now = Date.now();

    const rawResults = await this.provider.query(vector, {
      limit: limit * 4,
      threshold: 0,
      filter: { [T.type]: 'belief' },
    });

    const scored: Array<MindBelief & { score: number }> = [];

    for (const r of rawResults) {
      const belief = this.chunkToBelief(r.chunk);
      if (!includeExpired && belief.expiresAt && belief.expiresAt < now) continue;
      if (tags?.length && !tags.every(t => belief.tags.includes(t))) continue;

      const ageDays = (now - belief.createdAt) / 86_400_000;
      const recency = Math.exp(-ageDays / HALF_LIFE_DAYS);
      const confWeight = belief.error ? 0.3 : CONFIDENCE_VALUES[belief.confidence];
      const score = r.score * SEMANTIC_W + recency * RECENCY_W + confWeight * CONFIDENCE_W;
      if (score < threshold) continue;
      scored.push({ ...belief, score });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async queryReflections(
    vector: number[],
    options: {
      limit?: number;
      threshold?: number;
      tags?: string[];
      pinned?: boolean;
    },
  ): Promise<Array<MindReflection & { score: number }>> {
    const { limit = 10, threshold = 0, tags, pinned } = options;
    const now = Date.now();

    const filter: MetadataFilter = { [T.type]: 'reflection' };
    if (pinned === true) (filter as Record<string, unknown>)[T.pinned] = true;

    const rawResults = await this.provider.query(vector, {
      limit: limit * 4,
      threshold: 0,
      filter,
    });

    const scored: Array<MindReflection & { score: number }> = [];

    for (const r of rawResults) {
      const ref = this.chunkToReflection(r.chunk);
      if (pinned === false && ref.pinned) continue;
      if (tags?.length && !tags.every(t => ref.tags.includes(t))) continue;

      const ageDays = (now - ref.createdAt) / 86_400_000;
      const recency = Math.exp(-ageDays / HALF_LIFE_DAYS);
      const score = r.score * SEMANTIC_W + recency * RECENCY_W + CONFIDENCE_VALUES.medium * CONFIDENCE_W;
      if (score < threshold) continue;
      scored.push({ ...ref, score });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Find existing active belief above the cosine threshold. Used for dedup check.
  async findSimilarBelief(
    vector: number[],
    threshold: number,
  ): Promise<{ id: string; score: number; belief: MindBelief } | null> {
    const now = Date.now();
    const results = await this.provider.query(vector, {
      limit: 5,
      threshold,
      filter: { [T.type]: 'belief' },
    });
    for (const r of results) {
      const belief = this.chunkToBelief(r.chunk);
      // Archived (expired) beliefs are excluded from dedup
      if (belief.expiresAt && belief.expiresAt < now) continue;
      return { id: r.chunk.id, score: r.score, belief };
    }
    return null;
  }

  // --- Writes ---

  async addGoal(goal: Omit<MindGoal, 'id'>): Promise<string> {
    const id = randomUUID();
    await this.provider.add([this.goalToChunk({ ...goal, id })]);
    return id;
  }

  async updateGoal(
    id: string,
    updates: {
      description?: string;
      priority?: GoalPriority;
      status?: GoalStatus;
      outcome?: string;
      appendProgress?: string;
    },
  ): Promise<void> {
    const chunk = await this._getById(id);
    if (!chunk) throw new Error(`[AgentMind] Goal not found: ${id}`);
    const goal = this.chunkToGoal(chunk);
    const updated: MindGoal = {
      ...goal,
      description: updates.description ?? goal.description,
      priority: updates.priority ?? goal.priority,
      status: updates.status ?? goal.status,
      outcome: updates.outcome ?? goal.outcome,
      progress: updates.appendProgress ? [...goal.progress, updates.appendProgress] : goal.progress,
      updatedAt: Date.now(),
    };
    await this.provider.add([this.goalToChunk(updated)]);
  }

  async completeGoal(id: string, outcome?: string): Promise<void> {
    const chunk = await this._getById(id);
    if (!chunk) throw new Error(`[AgentMind] Goal not found: ${id}`);
    const goal = this.chunkToGoal(chunk);
    await this.provider.add([
      this.goalToChunk({
        ...goal,
        status: 'completed',
        outcome: outcome ?? goal.outcome,
        updatedAt: Date.now(),
      }),
    ]);
  }

  async addBelief(belief: Omit<MindBelief, 'id'>, vector: number[]): Promise<string> {
    const id = randomUUID();
    await this.provider.add([this.beliefToChunk({ ...belief, id }, vector)]);
    return id;
  }

  async updateBelief(
    id: string,
    updates: Partial<Pick<MindBelief, 'content' | 'confidence' | 'tags' | 'expiresAt' | 'error'>>,
    vector?: number[],
  ): Promise<void> {
    const chunk = await this._getById(id);
    if (!chunk) throw new Error(`[AgentMind] Belief not found: ${id}`);
    const belief = this.chunkToBelief(chunk);
    const updated: MindBelief = {
      ...belief,
      content: updates.content ?? belief.content,
      confidence: updates.confidence ?? belief.confidence,
      tags: updates.tags ?? belief.tags,
      expiresAt: updates.expiresAt !== undefined ? updates.expiresAt : belief.expiresAt,
      error: updates.error ?? belief.error,
      updatedAt: Date.now(),
    };
    const useVector = vector ?? chunk.vector ?? this.zeroVector;
    await this.provider.add([this.beliefToChunk(updated, useVector)]);
  }

  async addReflection(reflection: Omit<MindReflection, 'id'>, vector: number[]): Promise<string> {
    const id = randomUUID();
    await this.provider.add([this.reflectionToChunk({ ...reflection, id }, vector)]);
    return id;
  }

  async updateReflection(
    id: string,
    updates: Partial<Pick<MindReflection, 'pinned' | 'error'>>,
  ): Promise<void> {
    const chunk = await this._getById(id);
    if (!chunk) throw new Error(`[AgentMind] Reflection not found: ${id}`);
    const ref = this.chunkToReflection(chunk);
    const updated: MindReflection = {
      ...ref,
      pinned: updates.pinned ?? ref.pinned,
      error: updates.error ?? ref.error,
      updatedAt: Date.now(),
    };
    await this.provider.add([
      this.reflectionToChunk(updated, chunk.vector ?? this.zeroVector),
    ]);
  }

  // --- Serialization ---

  goalToChunk(goal: MindGoal): Chunk {
    return {
      id: goal.id,
      content: goal.description,
      metadata: {
        [T.type]: 'goal',
        [T.status]: goal.status,
        [T.priority]: goal.priority,
        [T.tags]: JSON.stringify(goal.tags),
        [T.progress]: JSON.stringify(goal.progress),
        [T.dueBy]: goal.dueBy ?? '',
        [T.outcome]: goal.outcome ?? '',
        [T.createdAt]: goal.createdAt,
        [T.updatedAt]: goal.updatedAt,
      },
      vector: this.zeroVector,
    };
  }

  chunkToGoal(chunk: Chunk): MindGoal {
    const m = chunk.metadata;
    return {
      id: chunk.id,
      type: 'goal',
      description: chunk.content,
      status: m[T.status] as GoalStatus,
      priority: m[T.priority] as GoalPriority,
      tags: this._parseTags(m[T.tags] as string),
      progress: this._parseTags(m[T.progress] as string),
      dueBy: (m[T.dueBy] as string) || undefined,
      outcome: (m[T.outcome] as string) || undefined,
      createdAt: m[T.createdAt] as number,
      updatedAt: m[T.updatedAt] as number,
    };
  }

  beliefToChunk(belief: MindBelief, vector: number[]): Chunk {
    return {
      id: belief.id,
      content: belief.content,
      metadata: {
        [T.type]: 'belief',
        [T.confidence]: belief.confidence,
        [T.tags]: JSON.stringify(belief.tags),
        [T.expiresAt]: belief.expiresAt ?? 0,
        [T.error]: belief.error === true,
        [T.createdAt]: belief.createdAt,
        [T.updatedAt]: belief.updatedAt,
      },
      vector,
    };
  }

  chunkToBelief(chunk: Chunk): MindBelief {
    const m = chunk.metadata;
    return {
      id: chunk.id,
      type: 'belief',
      content: chunk.content,
      confidence: m[T.confidence] as ConfidenceLevel,
      tags: this._parseTags(m[T.tags] as string),
      expiresAt: (m[T.expiresAt] as number) || undefined,
      error: (m[T.error] as boolean) || undefined,
      createdAt: m[T.createdAt] as number,
      updatedAt: m[T.updatedAt] as number,
    };
  }

  reflectionToChunk(reflection: MindReflection, vector: number[]): Chunk {
    return {
      id: reflection.id,
      content: reflection.content,
      metadata: {
        [T.type]: 'reflection',
        [T.pinned]: reflection.pinned,
        [T.tags]: JSON.stringify(reflection.tags),
        [T.relatedTo]: reflection.relatedTo ?? '',
        [T.error]: reflection.error === true,
        [T.createdAt]: reflection.createdAt,
        [T.updatedAt]: reflection.updatedAt,
      },
      vector,
    };
  }

  chunkToReflection(chunk: Chunk): MindReflection {
    const m = chunk.metadata;
    return {
      id: chunk.id,
      type: 'reflection',
      content: chunk.content,
      pinned: m[T.pinned] as boolean,
      tags: this._parseTags(m[T.tags] as string),
      relatedTo: (m[T.relatedTo] as string) || undefined,
      error: (m[T.error] as boolean) || undefined,
      createdAt: m[T.createdAt] as number,
      updatedAt: m[T.updatedAt] as number,
    };
  }

  // --- Private helpers ---

  private async _getById(id: string): Promise<Chunk | null> {
    const all = await this.provider.getAllChunks?.();
    if (all) return all.find(c => c.id === id) ?? null;
    return null;
  }

  private async _getAllByMeta(
    predicate: (meta: Record<string, unknown>) => boolean,
  ): Promise<Chunk[]> {
    const all = await this.provider.getAllChunks?.() ?? [];
    return all.filter(c => predicate(c.metadata));
  }

  private _parseTags(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

}
