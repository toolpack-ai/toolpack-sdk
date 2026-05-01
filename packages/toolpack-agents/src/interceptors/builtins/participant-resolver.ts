import type { AgentInput, Participant } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';

/**
 * Configuration for the participant resolver interceptor.
 */
export interface ParticipantResolverConfig {
  /**
   * Explicit resolver function. Takes precedence over the channel's
   * `resolveParticipant` hook when provided.
   *
   * If omitted, the interceptor will call `ctx.channel.resolveParticipant`
   * if the channel defines one. If neither is available, the input's
   * existing `participant` field (populated by `channel.normalize()`) is
   * passed through unchanged.
   */
  resolveParticipant?: (input: AgentInput) => Participant | undefined | Promise<Participant | undefined>;

  /**
   * Optional callback fired after a participant is resolved (from any
   * source, including `channel.normalize()`).
   */
  onResolved?: (input: AgentInput, participant: Participant) => void;
}

/**
 * Creates a participant resolver interceptor.
 *
 * Resolves the participant from input and enriches the input with participant
 * information for downstream interceptors. This is a foundational interceptor
 * that should typically be placed early in the chain so downstream interceptors
 * have access to participant context.
 *
 * Note: This interceptor does NOT write to conversation history. It only
 * enriches the input with participant metadata. History persistence must be
 * handled separately by the application layer or a future history interceptor.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createParticipantResolverInterceptor({
 *         resolveParticipant: (input) => ({
 *           kind: 'user',
 *           id: input.context?.userId as string,
 *           displayName: input.context?.userName as string
 *         }),
 *         onResolved: (input, participant) => {
 *           // Optionally persist to your own history store
 *           historyStore.append({ participant, message: input.message });
 *         }
 *       })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createParticipantResolverInterceptor(
  config: ParticipantResolverConfig = {}
): Interceptor {
  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    // Resolution order:
    //   1. Explicit `config.resolveParticipant`
    //   2. Channel's own `resolveParticipant` hook (lazy, cached)
    //   3. Whatever the channel already placed on `input.participant`
    let resolved: Participant | undefined;

    if (config.resolveParticipant) {
      resolved = await config.resolveParticipant(input);
    } else if (typeof ctx.channel.resolveParticipant === 'function') {
      try {
        resolved = await ctx.channel.resolveParticipant(input);
      } catch (error) {
        // Resolver must never crash the pipeline - log and fall through.
        ctx.logger?.warn('Channel resolveParticipant threw; falling back', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Merge resolved participant over whatever normalize() already set,
    // so a later lookup of `displayName` takes precedence over id-only.
    const participant = resolved ?? input.participant;

    if (participant) {
      const enrichedInput: AgentInput = {
        ...input,
        participant,
        // Keep legacy context slot populated for back-compat with older
        // interceptors that read `context._participant`.
        context: {
          ...input.context,
          _participant: participant,
        },
      };

      config.onResolved?.(enrichedInput, participant);
      ctx.logger?.debug('Resolved participant', {
        participantId: participant.id,
        participantKind: participant.kind,
      });

      return await next(enrichedInput);
    }

    // Nothing to enrich - pass through unchanged.
    return await next();
  };
}
