import { randomUUID } from 'crypto';
import type { MindStore } from './store.js';
import type {
  DraftBelieve,
  DraftReflect,
  DraftSetGoal,
  DraftUpdateGoal,
  DraftUnpinReflection,
  DraftOperation,
  ConfidenceLevel,
  GoalPriority,
  MindBelief,
} from './types.js';
import { parseDurationMs, parseDueBy, cosineSimilarity } from './utils.js';

export interface DraftBeliefInput {
  content: string;
  confidence: ConfidenceLevel;
  tags: string[];
  expiresIn?: string; // duration string like '30d'
  allowDowngrade: boolean;
  ttlDefault?: string; // agent-level default TTL for beliefs
}

export interface DraftReflectInput {
  content: string;
  pinned: boolean;
  tags: string[];
  relatedTo?: string;
}

export interface DraftSetGoalInput {
  description: string;
  priority: GoalPriority;
  tags: string[];
  dueBy?: string;
}

export interface DraftUpdateGoalInput {
  id: string;
  description?: string;
  priority?: GoalPriority;
  progress?: string;
}

export interface AddBeliefResult {
  action: 'created' | 'updated_store' | 'updated_draft';
  id: string;
}

export interface AddReflectResult {
  id: string;
  warning?: string;
}

export interface AddGoalResult {
  id: string;
}

// Per-run write buffer. Created fresh at the start of each run() call.
export class DraftBuffer {
  private ops: DraftOperation[] = [];

  constructor(
    private readonly store: MindStore,
    private readonly deduplicationThreshold: number,
    private readonly maxGoals: number,
    private readonly maxPinnedReflections: number,
    private readonly committedGoalCount: number,
    private readonly committedPinnedReflectionCount: number,
  ) {}

  // --- Counts (including in-draft items) ---

  get draftGoalCount(): number {
    return this.ops.filter(o => o.op === 'set_goal').length;
  }

  get draftPinnedReflectionCount(): number {
    return this.ops.filter(o => o.op === 'reflect' && (o as DraftReflect).pinned).length;
  }

  get totalGoalCount(): number {
    return this.committedGoalCount + this.draftGoalCount;
  }

  get totalPinnedReflectionCount(): number {
    return this.committedPinnedReflectionCount + this.draftPinnedReflectionCount;
  }

  // --- Write operations ---

  async addBelieve(input: DraftBeliefInput): Promise<AddBeliefResult> {
    const now = Date.now();
    const vector = await this.store.embed(input.content);

    // Compute expiresAt
    let expiresAt: number | undefined;
    const ttlStr = input.expiresIn ?? input.ttlDefault;
    if (ttlStr) {
      expiresAt = now + parseDurationMs(ttlStr);
    }

    // 1. Check existing draft buffer for dedup (eager, at write time)
    const draftMatch = this._findSimilarInDraft(vector);
    if (draftMatch !== null) {
      const existing = this.ops[draftMatch] as DraftBelieve;
      const newConf = input.confidence;
      const existConf = existing.confidence;

      const confOrder: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
      const shouldUpdateConf =
        confOrder[newConf] > confOrder[existConf] ||
        (input.allowDowngrade && confOrder[newConf] < confOrder[existConf]);

      // Replace the draft entry in-place
      this.ops[draftMatch] = {
        ...existing,
        content: input.content,
        confidence: shouldUpdateConf ? newConf : existConf,
        tags: input.tags.length > 0 ? input.tags : existing.tags,
        expiresAt,
        allowDowngrade: input.allowDowngrade,
        vector,
      } as DraftBelieve;

      return { action: 'updated_draft', id: existing.existingId ?? `draft-${draftMatch}` };
    }

    // 2. Check committed store for dedup
    const storeMatch = await this.store.findSimilarBelief(vector, this.deduplicationThreshold);
    if (storeMatch) {
      const existing: MindBelief = storeMatch.belief;
      const newConf = input.confidence;
      const existConf = existing.confidence;

      const confOrder: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
      const shouldUpdateConf =
        confOrder[newConf] > confOrder[existConf] ||
        (input.allowDowngrade && confOrder[newConf] < confOrder[existConf]);

      const entry: DraftBelieve = {
        op: 'believe',
        content: input.content,
        confidence: shouldUpdateConf ? newConf : existConf,
        tags: input.tags.length > 0 ? input.tags : existing.tags,
        expiresAt,
        allowDowngrade: input.allowDowngrade,
        createdAt: now,
        vector,
        existingId: storeMatch.id, // marks this as an update
      };
      this.ops.push(entry);
      return { action: 'updated_store', id: storeMatch.id };
    }

    // 3. New belief — append to draft
    const entry: DraftBelieve = {
      op: 'believe',
      content: input.content,
      confidence: input.confidence,
      tags: input.tags,
      expiresAt,
      allowDowngrade: input.allowDowngrade,
      createdAt: now,
      vector,
    };
    this.ops.push(entry);
    return { action: 'created', id: `draft-${this.ops.length - 1}` };
  }

  async addReflect(input: DraftReflectInput): Promise<AddReflectResult> {
    let warning: string | undefined;

    if (input.pinned) {
      const total = this.totalPinnedReflectionCount;
      if (total >= this.maxPinnedReflections) {
        throw new Error(
          `[AgentMind] Pinned reflection cap reached (${this.maxPinnedReflections}). ` +
          `Call mind_recall with type:'reflection' and pinned:true to list current pinned reflections, ` +
          `then call mind_unpin_reflection to remove one before adding another.`,
        );
      }
      if (total >= this.maxPinnedReflections - 2) {
        warning =
          `Pinned reflection count is ${total + 1} of ${this.maxPinnedReflections}. ` +
          `Review and unpin standing rules that are no longer universally applicable.`;
      }
    }

    // Embed at write time per spec (not deferred to flush)
    const vector = await this.store.embed(input.content);

    const entry: DraftReflect = {
      op: 'reflect',
      content: input.content,
      pinned: input.pinned,
      tags: input.tags,
      relatedTo: input.relatedTo,
      createdAt: Date.now(),
      vector,
    };
    const id = `draft-reflect-${this.ops.length}`;
    this.ops.push(entry);
    return { id, warning };
  }

  addSetGoal(input: DraftSetGoalInput): AddGoalResult {
    if (this.totalGoalCount >= this.maxGoals) {
      throw new Error(
        `[AgentMind] Active goal cap reached (${this.maxGoals}). ` +
        `Complete or archive an existing goal before setting a new one.`,
      );
    }

    const dueBy = input.dueBy ? parseDueBy(input.dueBy) : undefined;
    const entry: DraftSetGoal = {
      op: 'set_goal',
      tempId: randomUUID(),
      description: input.description,
      priority: input.priority,
      tags: input.tags,
      dueBy,
      createdAt: Date.now(),
    };
    this.ops.push(entry);
    return { id: entry.tempId };
  }

  addUpdateGoal(input: DraftUpdateGoalInput): void {
    const entry: DraftUpdateGoal = {
      op: 'update_goal',
      id: input.id,
      description: input.description,
      priority: input.priority,
      progress: input.progress,
      updatedAt: Date.now(),
    };
    this.ops.push(entry);
  }

  addUnpinReflection(id: string): void {
    const entry: DraftUnpinReflection = { op: 'unpin_reflection', id };
    this.ops.push(entry);
  }

  // --- Flush ---

  async flushClean(): Promise<void> {
    await this._flush(false);
  }

  async flushOnError(): Promise<void> {
    await this._flush(true);
  }

  private async _flush(isError: boolean): Promise<void> {
    const now = Date.now();

    for (const op of this.ops) {
      if (op.op === 'believe') {
        const b = op as DraftBelieve;
        if (isError) {
          // Flush with error:true; confidence stays as recorded but retrieval clamps it
          if (b.existingId) {
            await this.store.updateBelief(b.existingId, {
              content: b.content,
              confidence: b.confidence,
              tags: b.tags,
              expiresAt: b.expiresAt,
              error: true,
            }, b.vector);
          } else {
            await this.store.addBelief({
              type: 'belief',
              content: b.content,
              confidence: b.confidence,
              tags: b.tags,
              expiresAt: b.expiresAt,
              error: true,
              createdAt: b.createdAt,
              updatedAt: now,
            }, b.vector);
          }
        } else {
          if (b.existingId) {
            await this.store.updateBelief(b.existingId, {
              content: b.content,
              confidence: b.confidence,
              tags: b.tags,
              expiresAt: b.expiresAt,
            }, b.vector);
          } else {
            await this.store.addBelief({
              type: 'belief',
              content: b.content,
              confidence: b.confidence,
              tags: b.tags,
              expiresAt: b.expiresAt,
              createdAt: b.createdAt,
              updatedAt: now,
            }, b.vector);
          }
        }
      } else if (op.op === 'reflect') {
        const r = op as DraftReflect;
        await this.store.addReflection({
          type: 'reflection',
          content: r.content,
          pinned: r.pinned,
          tags: r.tags,
          relatedTo: r.relatedTo,
          error: isError || undefined,
          createdAt: r.createdAt,
          updatedAt: now,
        }, r.vector);
      } else if (op.op === 'set_goal') {
        if (!isError) {
          const g = op as DraftSetGoal;
          await this.store.addGoal({
            type: 'goal',
            description: g.description,
            priority: g.priority,
            status: 'active',
            tags: g.tags,
            dueBy: g.dueBy,
            progress: [],
            createdAt: g.createdAt,
            updatedAt: g.createdAt,
          });
        }
        // On error: drop goal writes entirely
      } else if (op.op === 'update_goal') {
        if (!isError) {
          const u = op as DraftUpdateGoal;
          await this.store.updateGoal(u.id, {
            description: u.description,
            priority: u.priority,
            appendProgress: u.progress,
          });
        }
        // On error: drop
      } else if (op.op === 'unpin_reflection') {
        // Unpin is dropped on error — reflection stays pinned, which is the safe default
        if (!isError) {
          const u = op as DraftUnpinReflection;
          await this.store.updateReflection(u.id, { pinned: false });
        }
      }
    }

    this.ops = []; // clear after flush
  }

  // --- Dedup helpers ---

  private _findSimilarInDraft(vector: number[]): number | null {
    const believes = this.ops
      .map((op, idx) => ({ op, idx }))
      .filter(({ op }) => op.op === 'believe');

    for (const { op, idx } of believes) {
      const b = op as DraftBelieve;
      if (b.vector.length === 0) continue;
      const sim = cosineSimilarity(vector, b.vector);
      if (sim >= this.deduplicationThreshold) {
        return idx;
      }
    }
    return null;
  }
}
