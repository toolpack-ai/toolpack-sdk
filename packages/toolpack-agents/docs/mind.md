# Agent Mind — Persistent Cognitive Layer

Agent Mind gives a `BaseAgent` a persistent memory that survives across runs. It stores three kinds of entries — goals, beliefs, and reflections — and automatically prepends a concise summary to every system prompt so the LLM always starts with relevant context.

## Contents

- [Overview](#overview)
- [Enabling the mind](#enabling-the-mind)
- [AgentMindConfig](#agentmindconfig)
- [MindTtlDefaults](#mindttldefaults)
- [System prompt header](#system-prompt-header)
- [LLM-callable tools](#llm-callable-tools)
  - [mind_recall](#mind_recall)
  - [mind_believe](#mind_believe)
  - [mind_reflect](#mind_reflect)
  - [mind_unpin_reflection](#mind_unpin_reflection)
  - [mind_set_goal](#mind_set_goal)
  - [mind_update_goal](#mind_update_goal)
  - [mind_complete_goal](#mind_complete_goal)
- [Entry types](#entry-types)
  - [MindGoal](#mindgoal)
  - [MindBelief](#mindbelief)
  - [MindReflection](#mindreflection)
  - [MindRecallResult](#mindrecallresult)
- [Enumerations](#enumerations)
- [Draft buffer and flush lifecycle](#draft-buffer-and-flush-lifecycle)
- [Integration with toolpack-knowledge](#integration-with-toolpack-knowledge)
- [Full example](#full-example)

---

## Overview

When `mind` is set on a `BaseAgent`, three things happen on every `run()` call:

1. **Header assembly** — the committed store is read and a `--- AGENT MIND ---` block is prepended to the system prompt. It contains active goals, pinned standing rules, high-confidence beliefs (within a token budget), and recent reflections.
2. **Tool injection** — 7 LLM-callable mind tools are added to the request tool list so the model can read and write memory mid-task.
3. **Flush** — when the run completes (cleanly or with an error) the draft buffer is committed to the store. Writes from within the run are not visible to `mind_recall` during the same run but are persisted for the next one.

Setting `mind` to `undefined` (the default) has zero overhead — no store is created, no tools are injected, and no header is built.

---

## Enabling the mind

```typescript
import { BaseAgent, AgentInput, AgentResult } from '@toolpack-sdk/agents';
import { OpenAIEmbedder } from '@toolpack-sdk/knowledge'; // or any Embedder implementation

class MyAgent extends BaseAgent {
  name = 'my-agent';
  description = 'An agent with persistent memory';
  mode = 'agent';

  mind = {
    embedder: new OpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
    // All other options are optional — see AgentMindConfig below
  };

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    return this.run(input.message ?? '');
  }
}
```

---

## AgentMindConfig

```typescript
interface AgentMindConfig {
  embedder: Embedder;
  provider?: KnowledgeProvider;
  namespace?: string;
  tokenBudget?: number;
  recencyWindowDays?: number;
  maxGoals?: number;
  maxPinnedReflections?: number;
  deduplicationThreshold?: number;
  retrievalThreshold?: number;
  ttlDefaults?: MindTtlDefaults;
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `embedder` | `Embedder` | — | **Required.** Embedding model used for semantic search and deduplication. Any implementation of `@toolpack-sdk/knowledge`'s `Embedder` interface is accepted. |
| `provider` | `KnowledgeProvider` | `PersistentKnowledgeProvider` | Storage backend. Omit to use the default SQLite-backed `PersistentKnowledgeProvider` (from `@toolpack-sdk/knowledge`). Pass a custom provider for alternative storage. |
| `namespace` | `string` | `mind/{agentName}` | Storage namespace prefix. Each agent gets its own isolated namespace by default. Override to share memory between agents or to use a custom path. |
| `tokenBudget` | `number` | `300` | Maximum tokens allocated to the header's beliefs and recent reflections sections combined. Does not count goals or pinned rules. |
| `recencyWindowDays` | `number` | `7` | How many days back to look when selecting recent reflections for the header. |
| `maxGoals` | `number` | `10` | Cap on active goals. Ceiling is 10 regardless of what is passed. `mind_set_goal` throws when the cap is reached. |
| `maxPinnedReflections` | `number` | `10` | Cap on pinned standing-rule reflections. Ceiling is 10. `mind_reflect` throws when the cap is reached. |
| `deduplicationThreshold` | `number` | `0.85` | Cosine similarity threshold (0–1) above which a new belief is considered a duplicate of an existing one and updated in place rather than added as a new entry. |
| `retrievalThreshold` | `number` | `0.35` | Composite score threshold (0–1) for `mind_recall` results. Entries below this score are excluded. Can be overridden per-call. |
| `ttlDefaults` | `MindTtlDefaults` | See below | Default TTL for beliefs and reflections. |

---

## MindTtlDefaults

```typescript
interface MindTtlDefaults {
  belief?: string;      // duration string, e.g. '30d'
  reflection?: string;  // duration string, e.g. '90d'
}
```

Duration strings use the format `'<n>d'` (days), e.g. `'30d'`, `'90d'`. The default belief TTL is `'30d'`. Reflections have no expiry by default.

A `mind_believe` call can override the agent-level default with `expiresIn`:

```typescript
// Agent default
mind = {
  embedder: myEmbedder,
  ttlDefaults: { belief: '30d', reflection: '90d' },
};

// Per-call override (from inside the LLM tool call or your own code)
// mind_believe({ content: '...', expiresIn: '7d' })
```

---

## System prompt header

At the start of each run, `assemble()` reads the committed store and builds a block prepended to the system prompt:

```
--- AGENT MIND ---

## Goals
[high] Migrate all production databases to PostgreSQL — last progress: schema migration complete (due: 2026-06-01)

## Standing Rules (Pinned)
- Always confirm destructive operations before executing them.

## Beliefs
- The staging environment uses a different API key than production. (high confidence)
- Rate limits on the external payments API are 100 req/min. (medium confidence)

## Recent Reflections
- [2026-05-20] The user prefers concise bullet-point summaries over prose.

---
```

- **Goals** — all active goals, sorted by creation time. Each line shows priority, description, last progress note, and due date.
- **Standing Rules (Pinned)** — reflections with `pinned: true`, always shown.
- **Beliefs** — high-confidence beliefs, trimmed to `tokenBudget`. Beliefs fill the budget before reflections.
- **Recent Reflections** — non-pinned reflections from the last `recencyWindowDays` days, filling remaining budget.

If the store is empty (first run, cold start), the block is omitted entirely.

---

## LLM-callable tools

Seven tools are injected into every `run()` call when `mind` is configured. The LLM can call them as normal tool calls. All write operations are buffered and only committed when the run finishes.

### mind_recall

Search the agent's persistent memory.

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `query` | `string` | Free-text query. Used for semantic search on beliefs and reflections; keyword matching on goals. |

**Optional parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | `'belief' \| 'reflection' \| 'goal' \| 'all'` | `'all'` | Entry type to search. |
| `status` | `'active' \| 'completed'` | `'active'` | For goal queries only. |
| `tags` | `string[]` | — | Filter to entries that have all of these tags. |
| `pinned` | `boolean` | — | When `true`, return only pinned reflections. |
| `includeExpired` | `boolean` | `false` | Whether to include archived (expired) beliefs. |
| `threshold` | `number` | `retrievalThreshold` | Composite score override (0–1) for this call. Silently ignored for goal queries. |
| `limit` | `number` | `5` | Maximum entries to return. |

**Returns:** Array of `MindRecallResult` objects.

**Important:** reads from the committed store only. Writes made during the current run (via `mind_believe`, `mind_reflect`, etc.) are not visible until the next run.

---

### mind_believe

Record a new belief or update an existing similar one.

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `content` | `string` | The belief statement. |

**Optional parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `confidence` | `'low' \| 'medium' \| 'high'` | `'medium'` | Certainty level at write time. |
| `tags` | `string[]` | `[]` | Tags for structured filtering via `mind_recall`. |
| `expiresIn` | `string` | `ttlDefaults.belief` | TTL override for this belief, e.g. `'7d'`, `'90d'`. |
| `allowDowngrade` | `boolean` | `false` | If `true`, allows confidence to be lowered when updating an existing belief. By default only upgrades are applied. |

**Returns:** `{ status: 'ok', action: 'created' | 'updated_store' | 'updated_draft', id: string }`

**Deduplication:** before writing, the tool computes the embedding of `content` and checks both the in-flight draft buffer and the committed store for a semantically similar entry above `deduplicationThreshold`. If found, the existing entry is updated rather than a duplicate created.

---

### mind_reflect

Log a post-task observation about agent performance.

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `content` | `string` | The observation to record. |

**Optional parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pin` | `boolean` | `false` | If `true`, marks as a standing rule always shown in the header. Capped at `maxPinnedReflections`. |
| `tags` | `string[]` | `[]` | Tags for filtering via `mind_recall`. |
| `relatedTo` | `string` | — | Informational context (e.g. a PR number or task ID). Not filterable — use tags for structured filtering. |

**Returns:** `{ status: 'ok', id: string, warning?: string }`

A `warning` is included when the pinned reflection count is within 2 of the cap, prompting the LLM to review and unpin outdated rules.

Reflections are append-only. They are never deduplicated.

---

### mind_unpin_reflection

Remove the pin flag from a standing-rule reflection.

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` | ID of the pinned reflection to unpin. Obtain via `mind_recall` with `type:'reflection'` and `pinned:true`. |

**Returns:** `{ status: 'ok' }`

The reflection remains in the store as a regular non-pinned reflection. On a crash (error flush), unpin operations are dropped — the reflection stays pinned, which is the safe default.

---

### mind_set_goal

Create a new active goal to track across sessions.

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `description` | `string` | The goal statement. |

**Optional parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `priority` | `'low' \| 'normal' \| 'high'` | `'normal'` | Goal priority. Shown in the header. |
| `tags` | `string[]` | `[]` | Tags for filtering via `mind_recall`. |
| `dueBy` | `string` | — | Optional deadline. ISO 8601 date (e.g. `'2026-06-01'`) or duration string (e.g. `'30d'`). Metadata only — goals are not auto-archived when the deadline passes. |

**Returns:** `{ status: 'ok', id: string }`

**No deduplication.** Call `mind_recall` with `type:'goal'` before creating a goal to avoid duplicating an existing one. Throws when the active goal cap (`maxGoals`) is reached.

---

### mind_update_goal

Partially update an active goal.

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` | ID of the goal to update. Obtain via `mind_recall` with `type:'goal'`. |

**Optional parameters:**

| Parameter | Type | Description |
|---|---|---|
| `description` | `string` | Revised goal description. |
| `priority` | `'low' \| 'normal' \| 'high'` | Updated priority. |
| `progress` | `string` | A progress note to append to the goal's history. This is an append, not a replacement. |

**Returns:** `{ status: 'ok' }`

Does not complete the goal. Use `mind_complete_goal` to mark it done.

---

### mind_complete_goal

Mark an active goal as completed and archive it.

**Required parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` | ID of the goal to complete. Obtain via `mind_recall` with `type:'goal'`. |

**Optional parameters:**

| Parameter | Type | Description |
|---|---|---|
| `outcome` | `string` | Summary of what was accomplished. |

**Returns:** `{ status: 'ok' }`

Unlike other write tools, `mind_complete_goal` commits **immediately** — it does not go through the draft buffer. Completed goals are excluded from the header but remain queryable via `mind_recall` with `status:'completed'`.

---

## Entry types

### MindGoal

```typescript
interface MindGoal {
  id: string;
  type: 'goal';
  description: string;
  priority: GoalPriority;     // 'low' | 'normal' | 'high'
  status: GoalStatus;         // 'active' | 'completed'
  tags: string[];
  dueBy?: string;             // ISO 8601 date string
  progress: string[];         // ordered progress notes, oldest first
  outcome?: string;           // set when status === 'completed'
  createdAt: number;          // unix ms
  updatedAt: number;          // unix ms
}
```

### MindBelief

```typescript
interface MindBelief {
  id: string;
  type: 'belief';
  content: string;
  confidence: ConfidenceLevel; // 'low' | 'medium' | 'high'
  tags: string[];
  expiresAt?: number;          // unix ms; undefined = no expiry
  createdAt: number;
  updatedAt: number;
  error?: boolean;             // true when written during a crashed run
}
```

### MindReflection

```typescript
interface MindReflection {
  id: string;
  type: 'reflection';
  content: string;
  pinned: boolean;
  tags: string[];
  relatedTo?: string;  // informational only, not filterable
  createdAt: number;
  updatedAt: number;
  error?: boolean;     // true when written during a crashed run
}
```

### MindRecallResult

The unified result shape returned by `mind_recall`:

```typescript
interface MindRecallResult {
  id: string;
  type: 'goal' | 'belief' | 'reflection';
  content: string;
  score?: number;         // composite score for beliefs/reflections; absent for goals
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
```

---

## Enumerations

```typescript
type GoalStatus    = 'active' | 'completed';
type GoalPriority  = 'low' | 'normal' | 'high';
type ConfidenceLevel = 'low' | 'medium' | 'high';
type MindEntryType = 'goal' | 'belief' | 'reflection';
```

---

## Draft buffer and flush lifecycle

All write operations (`mind_believe`, `mind_reflect`, `mind_unpin_reflection`, `mind_set_goal`, `mind_update_goal`) are buffered in a per-run `DraftBuffer`. The buffer is created fresh at the start of every `run()` call and flushed at the end.

**Clean flush** (run completed without error):
- Beliefs are written or updated in the store.
- Reflections are appended.
- Goals are created or updated.
- Unpin operations are applied.

**Error flush** (run threw an exception):
- Beliefs and reflections are written with `error: true`. They are persisted but the `error` flag signals that they were recorded during a failed run. `mind_recall` returns them normally; callers can filter on `error` if needed.
- Goal create and update operations are **dropped** — goals do not accumulate from crashed runs.
- Unpin operations are **dropped** — the reflection stays pinned, which is the safe default.

**`mind_complete_goal` is exempt** — it commits directly to the store immediately when called, bypassing the draft buffer entirely.

---

## Integration with toolpack-knowledge

Agent Mind is built on top of `@toolpack-sdk/knowledge`. The `provider` option accepts any `KnowledgeProvider` from that package. When `provider` is omitted, Mind automatically instantiates a `PersistentKnowledgeProvider` (SQLite-backed) in the namespace `mind/{agentName}`.

Semantic deduplication and retrieval use the `Embedder` you provide. Any embedding model that implements the `Embedder` interface works.

```bash
# Install the knowledge package
npm install @toolpack-sdk/knowledge
```

The `AgentMind` class is lazily initialised — it is created the first time `run()` is called, not at agent construction time. This means the `provider` and embedder are not initialised until the agent actually runs.

---

## Full example

```typescript
import { BaseAgent, AgentInput, AgentResult } from '@toolpack-sdk/agents';
import { AGENT_MODE } from 'toolpack-sdk';

class ResearchTrackerAgent extends BaseAgent {
  name = 'research-tracker';
  description = 'Tracks research goals and learns from past runs';

  mode = {
    ...AGENT_MODE,
    systemPrompt: `You are a research tracker agent.
At the start of each task, check your mind for relevant past context.
At the end of each task, record what you learned as beliefs and any performance notes as reflections.`,
  };

  // Enable persistent memory
  mind = {
    embedder: new OpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
    tokenBudget: 400,
    recencyWindowDays: 14,
    maxGoals: 5,
    ttlDefaults: {
      belief: '60d',      // beliefs last 60 days by default
      reflection: '90d',  // reflections last 90 days by default
    },
  };

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    return this.run(input.message ?? '');
  }
}

const agent = new ResearchTrackerAgent({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

await agent.start();
```

**Example LLM tool call sequence within a single run:**

```
// At the start of a task:
mind_recall({ query: "semiconductor supply chain", type: "all", limit: 5 })

// After making a discovery:
mind_believe({ content: "TSMC Q2 2026 capacity is fully booked.", confidence: "high", tags: ["tsmc", "supply-chain"] })

// Create a follow-up goal:
mind_set_goal({ description: "Monitor TSMC Q3 2026 capacity announcements", priority: "high", tags: ["tsmc"] })

// At the end of the task:
mind_reflect({ content: "Search queries with specific company names return better results than generic queries.", pin: false })
```

These writes are buffered and committed after the run completes successfully. The next run will see them in the header and via `mind_recall`.
