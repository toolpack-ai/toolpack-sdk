import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';

/**
 * Configuration for the depth guard interceptor.
 */
export interface DepthGuardConfig {
  /** Maximum allowed invocation depth (default: 5) */
  maxDepth?: number;

  /** Optional callback when depth limit is exceeded */
  onDepthExceeded?: (currentDepth: number, maxDepth: number, input: AgentInput) => void;
}

/**
 * Error thrown when invocation depth exceeds the configured maximum.
 */
export class DepthExceededError extends Error {
  constructor(
    public readonly currentDepth: number,
    public readonly maxDepth: number
  ) {
    super(`Maximum invocation depth exceeded: ${currentDepth} > ${maxDepth}`);
    this.name = 'DepthExceededError';
  }
}

/**
 * Creates a depth guard interceptor.
 *
 * Enforces maximum invocation depth on delegate chains.
 * This provides an early check before the actual delegation happens,
 * complementing the depth tracking in the chain composer.
 *
 * **Limitation:** This interceptor checks `ctx.invocationDepth`, which is always 0
 * for top-level chain invocations. It only fires when a delegated agent (called via
 * `ctx.delegateAndWait`) also has this interceptor and enters via the registry's
 * interceptor chain. Since `ctx.delegateAndWait` calls `targetAgent.invokeAgent`
 * directly (bypassing the chain), this interceptor is primarily belt-and-suspenders
 * for future scenarios where delegated calls may route through the registry.
 *
 * The actual depth protection lives in `ctx.delegateAndWait`'s internal
 * `nextDepth > maxDepth` check in the chain composer.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createDepthGuardInterceptor({ maxDepth: 5 })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createDepthGuardInterceptor(config: DepthGuardConfig = {}): Interceptor {
  const maxDepth = config.maxDepth ?? 5;

  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    if (ctx.invocationDepth > maxDepth) {
      config.onDepthExceeded?.(ctx.invocationDepth, maxDepth, input);
      ctx.logger?.error(`Depth guard: invocation depth ${ctx.invocationDepth} exceeds maximum ${maxDepth}`, {
        currentDepth: ctx.invocationDepth,
        maxDepth,
      });
      throw new DepthExceededError(ctx.invocationDepth, maxDepth);
    }

    return await next();
  };
}
