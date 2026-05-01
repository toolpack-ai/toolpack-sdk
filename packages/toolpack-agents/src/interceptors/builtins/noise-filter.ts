import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';

/**
 * Configuration for the noise filter interceptor.
 */
export interface NoiseFilterConfig {
  /** List of subtypes to drop (e.g., ['message_changed', 'message_deleted']) */
  denySubtypes: string[];

  /** Optional function to extract subtype from input */
  getSubtype?: (input: AgentInput) => string | undefined;

  /** Optional callback when noise is filtered */
  onFiltered?: (subtype: string, input: AgentInput) => void;
}

/**
 * Creates a noise filter interceptor.
 *
 * Drops messages whose subtype is in the deny-list.
 * Useful for filtering out message edits, deletions, bot messages, etc.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createNoiseFilterInterceptor({
 *         denySubtypes: ['message_changed', 'message_deleted', 'bot_message']
 *       })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createNoiseFilterInterceptor(config: NoiseFilterConfig): Interceptor {
  const getSubtype = config.getSubtype ?? ((input: AgentInput) => input.context?.subtype as string | undefined);
  const denySet = new Set(config.denySubtypes);

  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    const subtype = getSubtype(input);

    if (subtype && denySet.has(subtype)) {
      // Message subtype is in deny-list - skip silently
      config.onFiltered?.(subtype, input);
      ctx.logger?.debug(`Noise filter: dropping message with subtype "${subtype}"`, { subtype });
      return ctx.skip();
    }

    return await next();
  };
}
