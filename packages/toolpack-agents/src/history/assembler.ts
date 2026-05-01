import { randomUUID } from 'crypto';
import type { ConversationStore, StoredMessage, AssemblerOptions, AssembledPrompt, PromptMessage } from 'toolpack-sdk';
import type { SummarizerAgent, SummarizerOutput, HistoryTurn } from '../capabilities/summarizer-agent.js';

/**
 * Estimate the token count of a string (characters / 4).
 * Fast and good enough for budget enforcement; not exact.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Convert a `StoredMessage` to the summarizer's `HistoryTurn` format.
 * The assembler calls this before passing history to `SummarizerAgent`.
 */
function toHistoryTurn(message: StoredMessage): HistoryTurn {
  return {
    id: message.id,
    participant: message.participant,
    content: message.content,
    timestamp: message.timestamp,
  };
}

/**
 * Project a `StoredMessage` into a `PromptMessage` from the perspective of a
 * specific agent (identified by `agentId`).
 *
 * Projection table (per plan doc):
 * | Stored participant                       | role      | content                          |
 * |------------------------------------------|-----------|----------------------------------|
 * | kind: 'system'                           | system    | as-is                            |
 * | kind: 'user'                             | user      | "{displayName}: {content}"       |
 * | kind: 'agent', id === agentId            | assistant | as-is                            |
 * | kind: 'agent', id !== agentId            | user      | "{name} (agent): {content}"      |
 */
function project(message: StoredMessage, agentId: string): PromptMessage {
  const { participant, content } = message;

  if (participant.kind === 'system') {
    return { role: 'system', content };
  }

  if (participant.kind === 'agent') {
    if (participant.id === agentId) {
      // Current agent's own turn → assistant.
      return { role: 'assistant', content };
    }
    // Peer agent → user with label.
    const name = participant.displayName ?? participant.id;
    return { role: 'user', content: `${name} (agent): ${content}` };
  }

  // kind === 'user'
  const displayName = participant.displayName ?? participant.id;
  return { role: 'user', content: `${displayName}: ${content}` };
}

/**
 * Check whether an agent was "involved" in a message.
 * Used for addressed-only mode filtering.
 *
 * An agent is considered involved if:
 * - The message was sent by the agent itself (authorship matches `agentId`), OR
 * - Any id in `agentAllIds` appears in the message's `metadata.mentions` list.
 *
 * Two distinct id sets are used because:
 * - **Authorship** — the capture interceptor always writes the stable agent name
 *   (`agentId`) as `participant.id`, regardless of platform.
 * - **Mentions** — platforms store mentions as their own user ids (e.g. Slack's
 *   `'U_BOT123'`), which may differ from the stable agent name. `agentAllIds`
 *   covers both the stable name and any platform aliases.
 *
 * @param message     The stored message to test.
 * @param agentId     The agent's stable internal id (its registered name).
 * @param agentAllIds Set of all ids considered "this agent" for mention matching
 *                    (includes agentId itself plus any platform aliases).
 */
function agentIsInvolved(
  message: StoredMessage,
  agentId: string,
  agentAllIds: ReadonlySet<string>
): boolean {
  // Authorship: the capture interceptor writes the stable agent name.
  if (message.participant.id === agentId) return true;
  // @-mention: check against the full alias set (name + platform ids).
  if (message.metadata?.mentions?.some(m => agentAllIds.has(m))) return true;
  return false;
}

/**
 * Assemble a prompt slice from conversation history for a specific agent.
 *
 * This is the function that actually controls token cost. It:
 * 1. Loads a scoped, time-windowed slice of history from the store.
 * 2. Optionally filters to turns where the agent was involved (addressed-only mode).
 * 3. Triggers rolling summarisation via `SummarizerAgent` when the turn count
 *    exceeds `options.rollingSummaryThreshold`.
 * 4. Projects each `StoredMessage` into the LLM's role-based format from the
 *    current agent's point of view.
 * 5. Enforces a hard token budget, filling priority slots top-down.
 *
 * @param store           The conversation store to read from.
 * @param conversationId  The conversation to load.
 * @param agentId         The current agent's stable id (its registered name).
 * @param agentName       The current agent's display name.
 * @param options         Tuning knobs — scope, budget, addressed-only mode, etc.
 * @param summarizer      Optional `SummarizerAgent` instance for rolling summaries.
 *                        When omitted, old turns are simply dropped when the
 *                        threshold is exceeded.
 *
 * @example
 * ```ts
 * const prompt = await assemblePrompt(store, conversationId, agent.name, agent.name, {
 *   scope: 'channel',
 *   tokenBudget: 3000,
 *   addressedOnlyMode: true,
 *   rollingSummaryThreshold: 40,
 * }, summarizerAgent);
 *
 * const response = await llm.chat([
 *   { role: 'system', content: agent.systemPrompt },
 *   ...prompt.messages,
 *   { role: 'user', content: triggeringMessage },
 * ]);
 * ```
 */
export async function assemblePrompt(
  store: ConversationStore,
  conversationId: string,
  agentId: string,
  agentName: string,
  options: AssemblerOptions = {},
  summarizer?: SummarizerAgent
): Promise<AssembledPrompt> {
  const {
    scope,
    addressedOnlyMode = true,
    tokenBudget = 3000,
    rollingSummaryThreshold = 40,
    timeWindowMinutes,
    maxTurnsToLoad = 100,
    agentAliases,
  } = options;

  // Unified set of ids that mean "this agent" for involvement checking.
  // Always includes the stable agentId; callers add platform-specific ids
  // (e.g. Slack bot user id 'U_BOT123') via agentAliases so that @-mentions
  // stored as platform ids still trigger the addressed-only filter correctly.
  const agentAllIds: ReadonlySet<string> = new Set([agentId, ...(agentAliases ?? [])]);

  // --- 1. Load a scoped, time-windowed slice from the store ---

  const sinceTimestamp = timeWindowMinutes !== undefined
    ? new Date(Date.now() - timeWindowMinutes * 60 * 1000).toISOString()
    : undefined;

  let messages = await store.get(conversationId, {
    scope,
    sinceTimestamp,
    limit: maxTurnsToLoad,
  });

  const turnsLoaded = messages.length;

  // --- 2. Addressed-only mode: keep agent-involved turns + direct messages ---

  if (addressedOnlyMode) {
    // Build a set of involved message ids covering three criteria:
    //   a) The agent authored the message.
    //   b) The agent's id appears in the message's @-mention list.
    //   c) "Replied next" — the message immediately after this one is an
    //      agent-authored turn (i.e., this message was what the agent replied to).
    const involvedIds = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];

      if (agentIsInvolved(m, agentId, agentAllIds)) {
        involvedIds.add(m.id);
      }

      // Criterion (c): if the very next turn was authored by this agent,
      // include the current turn as the message that triggered the reply.
      // Authorship uses agentId (the stable name) — aliases are not needed here
      // because the capture interceptor always writes the stable name.
      if (i < messages.length - 1) {
        const next = messages[i + 1];
        if (next.participant.kind === 'agent' && next.participant.id === agentId) {
          involvedIds.add(m.id);
        }
      }
    }

    // Always include the most recent message — it's the triggering message and
    // must always be in context regardless of whether the agent was addressed.
    const mostRecent = messages[messages.length - 1];
    if (mostRecent) {
      involvedIds.add(mostRecent.id);
    }

    messages = messages.filter(m => involvedIds.has(m.id));
  }

  // --- 3. Rolling summary: compress oldest turns when over threshold ---

  let hasSummary = false;

  if (messages.length > rollingSummaryThreshold && summarizer) {
    // Split: summarise the oldest portion, keep the recent tail verbatim.
    const splitPoint = Math.floor(messages.length / 2);
    const toSummarise = messages.slice(0, splitPoint);
    const recent = messages.slice(splitPoint);

    // Gap #8: exclude existing summary turns from the summariser input —
    // they are already compressed and feeding them back would double-summarise.
    // The summariser receives only the raw turns; the summary text itself is
    // preserved in the store as part of the new summary's content.
    const rawTurnsToSummarise = toSummarise.filter(m => !m.metadata?.isSummary);

    try {
      const summarizerResult = await summarizer.invokeAgent({
        message: 'summarize',
        data: {
          turns: rawTurnsToSummarise.map(toHistoryTurn),
          agentName,
          agentId,
          maxTokens: Math.floor(tokenBudget * 0.25), // summary gets ≤25% of budget
          extractDecisions: true,
        },
      });

      const parsed = JSON.parse(summarizerResult.output) as SummarizerOutput;

      const summaryMessage: StoredMessage = {
        id: `summary-${randomUUID()}`,
        conversationId,
        participant: { kind: 'system', id: 'summarizer' },
        content: `[Summary of ${parsed.turnsSummarized} earlier turns]: ${parsed.summary}`,
        timestamp: toSummarise[0].timestamp,
        scope: scope ?? 'channel',
        metadata: { isSummary: true },
      };

      messages = [summaryMessage, ...recent];
      hasSummary = true;

      // Gap #2: persist the summary to the store and delete the turns it covers.
      // This prevents the same turns from being re-summarised on subsequent calls,
      // eliminating redundant LLM cost and making the isSummary flag meaningful.
      // Errors here must not crash the pipeline — the in-memory result is still valid.
      try {
        await store.append(summaryMessage);
        await store.deleteMessages(conversationId, toSummarise.map(m => m.id));
      } catch {
        // Persistence failure is non-fatal: the in-memory assembled prompt is
        // still correct for this call; the turns will simply be re-summarised
        // on the next invocation.
      }
    } catch {
      // Summarisation failure must not crash the pipeline.
      // Fall through with the full (unsummarised) recent slice.
      messages = messages.slice(-rollingSummaryThreshold);
    }
  } else if (messages.length > rollingSummaryThreshold) {
    // No summariser available — just keep the most recent turns.
    messages = messages.slice(-rollingSummaryThreshold);
  }

  // --- 4. Project each message into the LLM's role-based format ---

  const projected = messages.map(m => project(m, agentId));

  // --- 5. Enforce token budget (fill top-down, drop oldest when over) ---

  if (projected.length === 0) {
    return { messages: [], estimatedTokens: 0, turnsLoaded, hasSummary };
  }

  // The most recent message is the triggering message — always include it
  // regardless of budget so the agent is never completely blind.
  const lastMsg = projected[projected.length - 1];
  const budgetedMessages: PromptMessage[] = [lastMsg];
  let tokenCount = estimateTokens(lastMsg.content);

  // Walk older turns newest-first and fill whatever budget remains.
  for (let i = projected.length - 2; i >= 0; i--) {
    const msg = projected[i];
    const tokens = estimateTokens(msg.content);
    if (tokenCount + tokens > tokenBudget) break;
    budgetedMessages.unshift(msg);
    tokenCount += tokens;
  }

  return {
    messages: budgetedMessages,
    estimatedTokens: tokenCount,
    turnsLoaded,
    hasSummary,
  };
}
