import type { AgentInput, AgentResult, AgentInstance, ChannelInterface } from '../agent/types.js';
import type { IAgentRegistry } from '../agent/types.js';

/**
 * Sentinel value indicating the interceptor chain should end silently.
 * When returned by an interceptor, the registry must not call `channel.send`.
 */
export const SKIP_SENTINEL = Symbol('interceptor-skip-sentinel');

/**
 * Result from an interceptor or the chain.
 * - `AgentResult`: Normal result, send to channel
 * - `SkipSentinel`: Silent skip, do not send
 */
export type InterceptorResult = AgentResult | typeof SKIP_SENTINEL;

/**
 * Check if a result is the skip sentinel.
 */
export function isSkipSentinel(result: InterceptorResult): result is typeof SKIP_SENTINEL {
  return result === SKIP_SENTINEL;
}

/**
 * Helper function to create a skip sentinel result.
 * Use this in interceptors to signal "do not reply".
 */
export function skip(): typeof SKIP_SENTINEL {
  return SKIP_SENTINEL;
}

/**
 * Context available to each interceptor during chain execution.
 */
export interface InterceptorContext {
  /** The agent instance the chain wraps */
  agent: AgentInstance;

  /** The channel that triggered this invocation */
  channel: ChannelInterface;

  /** The registry for agent lookup and delegation. Null in standalone (single-agent) mode. */
  registry: IAgentRegistry | null;

  /** Current invocation depth (0 = top-level) */
  invocationDepth: number;

  /**
   * Delegate to another agent synchronously (depth-aware).
   * Increments invocation depth. Rejects if past depth cap.
   */
  delegateAndWait(agentName: string, input: Partial<AgentInput>): Promise<AgentResult>;

  /**
   * Signal that the chain should end silently.
   * Returns the skip sentinel - use `return ctx.skip()` to short-circuit.
   */
  skip: () => typeof SKIP_SENTINEL;

  /** Optional structured logger (wired by registry) */
  logger?: {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Next function in the interceptor chain.
 * Call this to continue to the next interceptor or the final agent invocation.
 *
 * Optionally pass a modified input to downstream interceptors/agents.
 * If no input is provided, the original input is used.
 *
 * @example
 * ```ts
 * // Pass modified input downstream
 * const modifiedInput = { ...input, context: { ...input.context, annotated: true } };
 * return await next(modifiedInput);
 *
 * // Or pass original input unchanged
 * return await next();
 * ```
 */
export type NextFunction = (input?: AgentInput) => Promise<InterceptorResult>;

/**
 * Interceptor function signature.
 * Middleware-style pattern: inspect/transform input, optionally continue.
 *
 * @param input The incoming agent input
 * @param ctx Context with agent, channel, registry, helpers
 * @param next Continue to next interceptor/agent
 * @returns Result (or skip sentinel to end silently)
 *
 * @example
 * ```ts
 * const myInterceptor: Interceptor = async (input, ctx, next) => {
 *   // Pre-processing
 *   if (shouldIgnore(input)) {
 *     return ctx.skip(); // Short-circuit silently
 *   }
 *
 *   // Continue chain
 *   const result = await next();
 *
 *   // Post-processing (optional)
 *   if (!isSkipSentinel(result)) {
 *     result.metadata = { ...result.metadata, intercepted: true };
 *   }
 *
 *   return result;
 * };
 * ```
 */
export type Interceptor = (
  input: AgentInput,
  ctx: InterceptorContext,
  next: NextFunction
) => Promise<InterceptorResult>;

/**
 * Configuration for the interceptor chain.
 */
export interface InterceptorChainConfig {
  /** Maximum invocation depth for delegation (default: 5) */
  maxInvocationDepth?: number;
}
