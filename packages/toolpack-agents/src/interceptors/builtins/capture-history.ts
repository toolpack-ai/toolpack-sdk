import { randomUUID } from 'crypto';
import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';
import { isSkipSentinel } from '../types.js';
import type { ConversationStore, ConversationScope, StoredMessage } from '../../history/types.js';

/**
 * Configuration for the capture-history interceptor.
 */
export interface CaptureHistoryConfig {
  /**
   * The conversation store to write messages into.
   * Typically `new InMemoryConversationStore()` for single-process deployments,
   * or a database-backed adapter for production.
   */
  store: ConversationStore;

  /**
   * Derive the scope of an incoming message.
   * Default: reads `input.context?.channelType` — `'im'` → `'dm'`,
   * presence of `context?.threadId` → `'thread'`, otherwise `'channel'`.
   */
  getScope?: (input: AgentInput) => ConversationScope;

  /**
   * Derive a stable message id for dedup.
   * Default: `input.context?.messageId ?? input.context?.eventId ?? randomUUID()`.
   * Supply this if your channel puts the platform message id somewhere else.
   */
  getMessageId?: (input: AgentInput) => string;

  /**
   * Derive explicit @-mention ids from the message for addressed-only filtering.
   * Default: `(input.context?.mentions as string[] | undefined) ?? []`.
   */
  getMentions?: (input: AgentInput) => string[];

  /**
   * Called after a message is successfully written to the store.
   * Useful for metrics or debug logging.
   */
  onCaptured?: (message: StoredMessage) => void;

  /**
   * When true, the interceptor also writes the agent's reply to the store
   * as a `kind: 'agent'` turn after `next()` returns.
   * Default: true.
   */
  captureAgentReplies?: boolean;
}

/**
 * Resolve the scope of an incoming message from its context.
 */
function defaultGetScope(input: AgentInput): ConversationScope {
  const ctx = input.context ?? {};

  // Platform DM signals:
  //   Slack:    channelType === 'im'
  //   Telegram: channelType === 'private'
  //   Discord:  channelType === 'dm'
  const channelType = ctx.channelType as string | undefined;
  if (channelType === 'im' || channelType === 'private' || channelType === 'dm') {
    return 'dm';
  }

  // If there is a threadId in context, treat this as a thread-scoped message.
  // Channel adapters (e.g. SlackChannel.normalize) are responsible for only
  // setting threadId when it is distinct from the conversationId, so no
  // additional equality check is needed here.
  if (ctx.threadId !== undefined) {
    return 'thread';
  }

  return 'channel';
}

/**
 * Creates a capture-history interceptor.
 *
 * **Purpose:** The capture stage runs for *every* allowed inbound message,
 * regardless of whether the agent ends up replying. It writes the message to
 * the `ConversationStore` so it is available as future context for the assembler.
 *
 * The interceptor wraps `next()`:
 * 1. Before calling downstream: write the inbound user message.
 * 2. After `next()` resolves (and the result is not a skip sentinel): write the
 *    agent's reply as a `kind: 'agent'` turn. This keeps the reply in the log
 *    automatically without any changes to agent code.
 *
 * **Placement:** Put this interceptor *after* `createParticipantResolverInterceptor`
 * (so `input.participant` is already enriched) and *before*
 * `createAddressCheckInterceptor` (so even ignored messages are captured).
 *
 * @example
 * ```ts
 * const store = new InMemoryConversationStore();
 *
 * interceptors: [
 *   createParticipantResolverInterceptor(),
 *   createCaptureInterceptor({ store }),   // ← before address-check
 *   createAddressCheckInterceptor({ agentName: 'kael', ... }),
 *   createIntentClassifierInterceptor({ ... }),
 * ]
 * ```
 */
/**
 * Symbol stamped onto every interceptor function returned by `createCaptureInterceptor`.
 * Used by `BaseAgent._bindChannel` to detect whether a capture interceptor has already
 * been wired — preventing the auto-inserted one from duplicating an explicit one.
 */
export const CAPTURE_INTERCEPTOR_MARKER = Symbol.for('toolpack:capture-history');

export function createCaptureInterceptor(config: CaptureHistoryConfig): Interceptor {
  // Resolve config options once at factory time — not per invocation.
  const captureAgentReplies = config.captureAgentReplies ?? true;
  const getScope = config.getScope ?? defaultGetScope;
  const getMessageId = config.getMessageId ?? ((inp: AgentInput) =>
    (inp.context?.messageId as string | undefined) ??
    (inp.context?.eventId as string | undefined) ??
    randomUUID()
  );
  const getMentions = config.getMentions ?? ((inp: AgentInput) =>
    (inp.context?.mentions as string[] | undefined) ?? []
  );

  const interceptorFn = async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    // --- Capture the inbound message ---

    const conversationId = input.conversationId;

    if (!conversationId) {
      // No conversationId means we cannot key the message; skip capture
      // but still let the chain continue.
      ctx.logger?.warn('[capture-history] Message has no conversationId — skipping capture');
      return await next();
    }

    const participant = input.participant;

    if (participant) {
      const inboundMessage: StoredMessage = {
        id: getMessageId(input),
        conversationId,
        participant,
        content: input.message ?? '',
        timestamp: new Date().toISOString(),
        scope: getScope(input),
        metadata: {
          channelType: input.context?.channelType as string | undefined,
          threadId: input.context?.threadId as string | undefined,
          messageId: input.context?.messageId as string | undefined,
          mentions: getMentions(input),
          channelName: input.context?.channelName as string | undefined,
          channelId: input.context?.channelId as string | undefined,
        },
      };

      try {
        await config.store.append(inboundMessage);
        config.onCaptured?.(inboundMessage);
        ctx.logger?.debug('[capture-history] Captured inbound message', {
          messageId: inboundMessage.id,
          participantId: participant.id,
          conversationId,
        });
      } catch (error) {
        // Storage errors must never crash the pipeline.
        ctx.logger?.warn('[capture-history] Failed to store inbound message', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // --- Call downstream (trigger, address-check, agent, etc.) ---

    const result = await next();

    // --- Capture the agent's reply (if it produced one) ---

    if (captureAgentReplies && !isSkipSentinel(result) && result.output != null) {
      const agentParticipant = {
        kind: 'agent' as const,
        id: ctx.agent.name,
        displayName: ctx.agent.name,
      };

      const replyMessage: StoredMessage = {
        id: randomUUID(),
        conversationId,
        participant: agentParticipant,
        content: result.output,
        timestamp: new Date().toISOString(),
        scope: getScope(input),
        metadata: {
          channelType: input.context?.channelType as string | undefined,
          threadId: input.context?.threadId as string | undefined,
          channelName: input.context?.channelName as string | undefined,
          channelId: input.context?.channelId as string | undefined,
        },
      };

      try {
        await config.store.append(replyMessage);
        config.onCaptured?.(replyMessage);
        ctx.logger?.debug('[capture-history] Captured agent reply', {
          messageId: replyMessage.id,
          agentId: ctx.agent.name,
          conversationId,
        });
      } catch (error) {
        ctx.logger?.warn('[capture-history] Failed to store agent reply', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  };

  (interceptorFn as unknown as Record<symbol, unknown>)[CAPTURE_INTERCEPTOR_MARKER] = true;
  return interceptorFn;
}
