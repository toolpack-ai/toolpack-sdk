import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';
import { isSkipSentinel } from '../types.js';

/**
 * Configuration for the tracer interceptor.
 */
export interface TracerConfig {
  /**
   * Log level for tracing (default: 'debug')
   */
  level?: 'debug' | 'info';

  /**
   * Whether to include full input data in logs (default: false)
   */
  includeInputData?: boolean;

  /**
   * Whether to include full result output in logs (default: false)
   */
  includeResultOutput?: boolean;

  /**
   * Optional: Filter which inputs to trace
   */
  shouldTrace?: (input: AgentInput) => boolean;
}

/**
 * Creates a tracer interceptor.
 *
 * Structured logging of each hop for debugging.
 * Logs entry (before calling next) and exit (after receiving result).
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createTracerInterceptor({ level: 'debug', includeInputData: true })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createTracerInterceptor(config: TracerConfig = {}): Interceptor {
  const level = config.level ?? 'debug';
  const includeInputData = config.includeInputData ?? false;
  const includeResultOutput = config.includeResultOutput ?? false;

  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    // Check if we should trace this input
    if (config.shouldTrace && !config.shouldTrace(input)) {
      return await next();
    }

    const logMethod = level === 'info' ? ctx.logger?.info : ctx.logger?.debug;

    // Log entry
    logMethod?.('Interceptor entry', {
      agent: ctx.agent.name,
      channel: ctx.channel.name,
      depth: ctx.invocationDepth,
      conversationId: input.conversationId,
      intent: input.intent,
      input: includeInputData ? input : undefined,
    });

    const startTime = performance.now();

    try {
      const result = await next();
      const duration = performance.now() - startTime;

      // Log exit
      if (isSkipSentinel(result)) {
        logMethod?.('Interceptor exit: skipped', {
          agent: ctx.agent.name,
          channel: ctx.channel.name,
          depth: ctx.invocationDepth,
          conversationId: input.conversationId,
          durationMs: duration.toFixed(2),
        });
      } else {
        logMethod?.('Interceptor exit: success', {
          agent: ctx.agent.name,
          channel: ctx.channel.name,
          depth: ctx.invocationDepth,
          conversationId: input.conversationId,
          durationMs: duration.toFixed(2),
          outputLength: result.output.length,
          result: includeResultOutput ? result : undefined,
        });
      }

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      // Log error
      ctx.logger?.error('Interceptor exit: error', {
        agent: ctx.agent.name,
        channel: ctx.channel.name,
        depth: ctx.invocationDepth,
        conversationId: input.conversationId,
        durationMs: duration.toFixed(2),
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name,
      });

      throw error;
    }
  };
}
