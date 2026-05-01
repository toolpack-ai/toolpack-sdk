import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';

/**
 * Configuration for the self filter interceptor.
 */
export interface SelfFilterConfig {
  /**
   * Platform-specific agent ID (e.g., Slack user ID "U123456").
   * If not provided, falls back to the agent's registered name.
   */
  agentId?: string;

  /** Function to extract sender ID from input */
  getSenderId: (input: AgentInput) => string | undefined;

  /** Optional callback when self-message is detected */
  onSelfMessage?: (senderId: string, input: AgentInput) => void;
}

/**
 * Creates a self filter interceptor (loop guard).
 *
 * Drops messages where the sender ID equals the agent's own ID.
 * Prevents infinite loops where the agent responds to its own messages.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createSelfFilterInterceptor({
 *         agentId: 'U0123456', // Slack bot user ID
 *         getSenderId: (input) => input.context?.senderId as string
 *       })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createSelfFilterInterceptor(config: SelfFilterConfig): Interceptor {
  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    const senderId = config.getSenderId(input);
    const agentId = config.agentId ?? ctx.agent.name; // Use platform ID if provided, else agent name

    if (senderId && senderId === agentId) {
      // Message is from self - skip to prevent loop
      config.onSelfMessage?.(senderId, input);
      ctx.logger?.debug(`Self filter: dropping self-message from ${senderId}`, { senderId, agentId });
      return ctx.skip();
    }

    return await next();
  };
}
