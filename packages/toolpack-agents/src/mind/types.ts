import type { KnowledgeProvider, Embedder } from '@toolpack-sdk/knowledge';

// --- Entry types ---

export type GoalStatus = 'active' | 'completed';
export type GoalPriority = 'low' | 'normal' | 'high';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type MindEntryType = 'goal' | 'belief' | 'reflection';

export interface MindGoal {
  id: string;
  type: 'goal';
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  tags: string[];
  dueBy?: string; // ISO 8601 date string
  progress: string[]; // ordered progress notes, oldest first
  outcome?: string; // set when status = 'completed'
  createdAt: number; // unix ms
  updatedAt: number; // unix ms
}

export interface MindBelief {
  id: string;
  type: 'belief';
  content: string;
  confidence: ConfidenceLevel;
  tags: string[];
  expiresAt?: number; // unix ms; undefined = no expiry
  createdAt: number;
  updatedAt: number;
  error?: boolean; // true when written during a crashed run
}

export interface MindReflection {
  id: string;
  type: 'reflection';
  content: string;
  pinned: boolean;
  tags: string[];
  relatedTo?: string; // informational only, not filterable
  createdAt: number;
  updatedAt: number;
  error?: boolean; // true when written during a crashed run
}

export type MindEntry = MindGoal | MindBelief | MindReflection;

// --- Public recall result shape ---

export interface MindRecallResult {
  id: string;
  type: MindEntryType;
  content: string;
  score?: number; // composite score for beliefs/reflections; absent for goals
  tags: string[];
  createdAt: number;
  updatedAt: number;
  // Goal-specific
  priority?: GoalPriority;
  status?: GoalStatus;
  progress?: string[];
  outcome?: string;
  dueBy?: string;
  // Belief-specific
  confidence?: ConfidenceLevel;
  expiresAt?: number;
  // Reflection-specific
  pinned?: boolean;
  relatedTo?: string;
  // Beliefs and reflections only
  error?: boolean;
}

// --- Config ---

export interface MindTtlDefaults {
  belief?: string; // duration string, e.g. '30d'
  reflection?: string;
}

export interface AgentMindConfig {
  embedder: Embedder;
  provider?: KnowledgeProvider;
  namespace?: string; // defaults to mind/{agentName}
  tokenBudget?: number; // default: 300
  recencyWindowDays?: number; // default: 7
  maxGoals?: number; // default: 10, ceiling: 10
  maxPinnedReflections?: number; // default: 10, ceiling: 10
  deduplicationThreshold?: number; // default: 0.85
  retrievalThreshold?: number; // default: 0.35
  ttlDefaults?: MindTtlDefaults;
}

export interface ResolvedMindConfig {
  tokenBudget: number;
  recencyWindowDays: number;
  maxGoals: number;
  maxPinnedReflections: number;
  deduplicationThreshold: number;
  retrievalThreshold: number;
  ttlDefaults: { belief: string | undefined; reflection: string | undefined };
  namespace: string;
}

// --- Draft buffer operation types ---

export interface DraftBelieve {
  op: 'believe';
  content: string;
  confidence: ConfidenceLevel;
  tags: string[];
  expiresAt?: number;
  allowDowngrade: boolean;
  createdAt: number;
  vector: number[]; // computed at write time
  existingId?: string; // set if this should update an existing store entry
}

export interface DraftReflect {
  op: 'reflect';
  content: string;
  pinned: boolean;
  tags: string[];
  relatedTo?: string;
  createdAt: number;
  vector: number[];
}

export interface DraftSetGoal {
  op: 'set_goal';
  tempId: string; // local id for cap counting
  description: string;
  priority: GoalPriority;
  tags: string[];
  dueBy?: string;
  createdAt: number;
}

export interface DraftUpdateGoal {
  op: 'update_goal';
  id: string;
  description?: string;
  priority?: GoalPriority;
  progress?: string; // note to append
  updatedAt: number;
}

export interface DraftUnpinReflection {
  op: 'unpin_reflection';
  id: string;
}

export type DraftOperation =
  | DraftBelieve
  | DraftReflect
  | DraftSetGoal
  | DraftUpdateGoal
  | DraftUnpinReflection;
