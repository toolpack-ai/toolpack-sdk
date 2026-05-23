import type { RequestToolDefinition } from 'toolpack-sdk';
import type { MindStore } from './store.js';
import type { DraftBuffer } from './draft-buffer.js';
import type {
  ResolvedMindConfig,
  MindRecallResult,
  GoalStatus,
  MindGoal,
  MindBelief,
  MindReflection,
  ConfidenceLevel,
  GoalPriority,
} from './types.js';

// Build all 7 mind tool definitions bound to the given store and draft buffer.
// Returns an array suitable for inclusion in requestTools.
export function buildMindTools(
  store: MindStore,
  draftBuffer: DraftBuffer,
  config: ResolvedMindConfig,
): RequestToolDefinition[] {
  return [
    buildMindRecall(store, config),
    buildMindBelieve(store, draftBuffer, config),
    buildMindReflect(draftBuffer, config),
    buildMindUnpinReflection(draftBuffer),
    buildMindSetGoal(draftBuffer, config),
    buildMindUpdateGoal(store, draftBuffer),
    buildMindCompleteGoal(store),
  ];
}

// --- mind_recall ---

function buildMindRecall(store: MindStore, config: ResolvedMindConfig): RequestToolDefinition {
  return {
    name: 'mind_recall',
    displayName: 'Mind Recall',
    description:
      'Search the agent\'s persistent memory for past beliefs, reflections, and goals. ' +
      'Use mid-task when the current task may have relevant past context not in the header. ' +
      'Reads from committed store only — writes from the current run are not visible here.',
    category: 'mind',
    cacheable: false,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search query. Used for semantic search on beliefs/reflections and text matching on goals.',
        },
        type: {
          type: 'string',
          enum: ['belief', 'reflection', 'goal', 'all'],
          description: "Entry type to search. Default: 'all'",
        },
        status: {
          type: 'string',
          enum: ['active', 'completed'],
          description: "For goal queries only. Default: 'active'",
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to entries that have all of these tags.',
        },
        pinned: {
          type: 'boolean',
          description: "When true, return only pinned reflections. For type:'all', applies only to the reflection subset.",
        },
        includeExpired: {
          type: 'boolean',
          description: 'Whether to include archived (expired) beliefs. Default: false',
        },
        threshold: {
          type: 'number',
          description: 'Composite score threshold override for this call (0–1). Results below this score are excluded. Silently ignored for goal queries.',
        },
        limit: {
          type: 'number',
          description: 'Max entries to return. Default: 5',
        },
      },
      required: ['query'],
    },
    execute: async (args: Record<string, unknown>) => {
      const query = String(args.query ?? '');
      const type = (args.type as string) ?? 'all';
      const status = (args.status as GoalStatus) ?? 'active';
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;
      const pinned = typeof args.pinned === 'boolean' ? args.pinned : undefined;
      const includeExpired = args.includeExpired === true;
      const threshold = typeof args.threshold === 'number' ? args.threshold : config.retrievalThreshold;
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 5;

      const results: MindRecallResult[] = [];
      const needsVector = (type === 'belief' || type === 'reflection' || type === 'all') && query.trim();
      const vector = needsVector ? await store.embed(query) : null;

      if (type === 'goal' || type === 'all') {
        const goals = await store.keywordSearchGoals(query, { limit, status, tags });
        for (const g of goals) {
          results.push(goalToRecall(g));
        }
      }

      if (vector && (type === 'belief' || type === 'all')) {
        const beliefs = await store.queryBeliefs(vector, {
          limit,
          threshold,
          tags,
          includeExpired,
        });
        for (const b of beliefs) {
          results.push(beliefToRecall(b));
        }
      }

      if (vector && (type === 'reflection' || type === 'all')) {
        const reflections = await store.queryReflections(vector, {
          limit,
          threshold,
          tags,
          pinned,
        });
        for (const r of reflections) {
          results.push(reflectionToRecall(r));
        }
      }

      return results;
    },
  };
}

// --- mind_believe ---

function buildMindBelieve(
  _store: MindStore,
  draftBuffer: DraftBuffer,
  config: ResolvedMindConfig,
): RequestToolDefinition {
  return {
    name: 'mind_believe',
    displayName: 'Mind Believe',
    description:
      'Record a new belief about the operating environment, or update an existing one. ' +
      'Call at the end of a task when you have learned something that should persist across runs. ' +
      'Deduplicates automatically — if a similar belief already exists above the similarity threshold it is updated in place. ' +
      'Writes are buffered and committed when the task completes cleanly.',
    category: 'mind',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The belief statement.',
        },
        confidence: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: "Certainty at write time. Default: 'medium'",
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for structured filtering via mind_recall.',
        },
        expiresIn: {
          type: 'string',
          description: "TTL override, e.g. '30d', '90d'. Overrides the agent default TTL.",
        },
        allowDowngrade: {
          type: 'boolean',
          description: 'If true, allows confidence downgrade on an existing belief. Default: false.',
        },
      },
      required: ['content'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = await draftBuffer.addBelieve({
        content: String(args.content),
        confidence: (args.confidence as ConfidenceLevel) ?? 'medium',
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        expiresIn: args.expiresIn ? String(args.expiresIn) : undefined,
        allowDowngrade: args.allowDowngrade === true,
        ttlDefault: config.ttlDefaults.belief,
      });
      return { status: 'ok', ...result };
    },
  };
}

// --- mind_reflect ---

function buildMindReflect(draftBuffer: DraftBuffer, config: ResolvedMindConfig): RequestToolDefinition {
  return {
    name: 'mind_reflect',
    displayName: 'Mind Reflect',
    description:
      'Log a post-task observation about your own performance. ' +
      'Reflections are append-only and not auto-injected (use pin:true to make a standing rule always shown in the header). ' +
      'Call at the end of a task with something you would do differently next time.',
    category: 'mind',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The post-task observation.',
        },
        pin: {
          type: 'boolean',
          description: `If true, marks as a standing rule always shown in the header. Capped at ${config.maxPinnedReflections}. Default: false`,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for structured filtering via mind_recall.',
        },
        relatedTo: {
          type: 'string',
          description: 'Informational context (e.g., a PR number or task ID). Not filterable — use tags for that.',
        },
      },
      required: ['content'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = await draftBuffer.addReflect({
        content: String(args.content),
        pinned: args.pin === true,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        relatedTo: args.relatedTo ? String(args.relatedTo) : undefined,
      });
      return { status: 'ok', ...result };
    },
  };
}

// --- mind_unpin_reflection ---

function buildMindUnpinReflection(draftBuffer: DraftBuffer): RequestToolDefinition {
  return {
    name: 'mind_unpin_reflection',
    displayName: 'Mind Unpin Reflection',
    description:
      'Remove the pin flag from a standing rule reflection. ' +
      'The reflection stays in the store as a regular non-pinned reflection. ' +
      'Use when a pinned rule is no longer universally applicable. ' +
      'Requires the reflection id — call mind_recall with type:reflection and pinned:true first.',
    category: 'mind',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the pinned reflection to unpin. Obtain via mind_recall.',
        },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      draftBuffer.addUnpinReflection(String(args.id));
      return { status: 'ok' };
    },
  };
}

// --- mind_set_goal ---

function buildMindSetGoal(draftBuffer: DraftBuffer, config: ResolvedMindConfig): RequestToolDefinition {
  return {
    name: 'mind_set_goal',
    displayName: 'Mind Set Goal',
    description:
      'Create a new active goal to track across sessions. ' +
      'No deduplication — call mind_recall with type:goal first to avoid re-creating existing goals. ' +
      `Goal cap is ${config.maxGoals} active goals; the call is rejected if the cap is reached.`,
    category: 'mind',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'The goal statement.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: "Goal priority. Default: 'normal'",
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for filtering via mind_recall.',
        },
        dueBy: {
          type: 'string',
          description: "Optional deadline. ISO 8601 date (e.g., '2026-06-01') or duration string (e.g., '30d'). Metadata only — goals are not auto-archived.",
        },
      },
      required: ['description'],
    },
    execute: async (args: Record<string, unknown>) => {
      const result = draftBuffer.addSetGoal({
        description: String(args.description),
        priority: (args.priority as GoalPriority) ?? 'normal',
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        dueBy: args.dueBy ? String(args.dueBy) : undefined,
      });
      return { status: 'ok', ...result };
    },
  };
}

// --- mind_update_goal ---

function buildMindUpdateGoal(_store: MindStore, draftBuffer: DraftBuffer): RequestToolDefinition {
  return {
    name: 'mind_update_goal',
    displayName: 'Mind Update Goal',
    description:
      'Partially update an active goal — change priority, description, or append a progress note. ' +
      'Does not complete the goal; use mind_complete_goal for that. ' +
      'Requires the goal id — call mind_recall with type:goal first.',
    category: 'mind',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the goal to update. Obtain via mind_recall.',
        },
        description: {
          type: 'string',
          description: 'Revised goal description.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: 'Updated priority.',
        },
        progress: {
          type: 'string',
          description: 'A progress note to append to the goal history. Not a replacement.',
        },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      draftBuffer.addUpdateGoal({
        id: String(args.id),
        description: args.description ? String(args.description) : undefined,
        priority: args.priority as GoalPriority | undefined,
        progress: args.progress ? String(args.progress) : undefined,
      });
      return { status: 'ok' };
    },
  };
}

// --- mind_complete_goal ---

function buildMindCompleteGoal(store: MindStore): RequestToolDefinition {
  return {
    name: 'mind_complete_goal',
    displayName: 'Mind Complete Goal',
    description:
      'Mark an active goal as completed and archive it. ' +
      'Commits immediately (does not go through the draft buffer). ' +
      'Completed goals are excluded from the header but remain queryable via mind_recall with status:completed. ' +
      'Requires the goal id — call mind_recall with type:goal first.',
    category: 'mind',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the goal to complete. Obtain via mind_recall with type:goal.',
        },
        outcome: {
          type: 'string',
          description: 'Optional summary of what was accomplished.',
        },
      },
      required: ['id'],
    },
    execute: async (args: Record<string, unknown>) => {
      await store.completeGoal(String(args.id), args.outcome ? String(args.outcome) : undefined);
      return { status: 'ok' };
    },
  };
}

// --- Serialisation helpers ---

function goalToRecall(g: MindGoal): MindRecallResult {
  return {
    id: g.id,
    type: 'goal',
    content: g.description,
    tags: g.tags,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    priority: g.priority,
    status: g.status,
    progress: g.progress,
    outcome: g.outcome,
    dueBy: g.dueBy,
  };
}

function beliefToRecall(b: MindBelief & { score: number }): MindRecallResult {
  return {
    id: b.id,
    type: 'belief',
    content: b.content,
    score: b.score,
    tags: b.tags,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    confidence: b.confidence,
    expiresAt: b.expiresAt,
    error: b.error,
  };
}

function reflectionToRecall(r: MindReflection & { score: number }): MindRecallResult {
  return {
    id: r.id,
    type: 'reflection',
    content: r.content,
    score: r.score,
    tags: r.tags,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    pinned: r.pinned,
    relatedTo: r.relatedTo,
    error: r.error,
  };
}
