import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorResult } from '../types.js';
import { isSkipSentinel } from '../types.js';

/**
 * OTel TracerProvider interface — mirrors @opentelemetry/api's TracerProvider
 * without requiring the package as a hard dependency.
 */
export interface OTelTracerProvider {
  getTracer(name: string, version?: string): OTelTracer;
}

export interface OTelTracer {
  startSpan(name: string, options?: OTelSpanOptions): OTelSpan;
}

export interface OTelSpanOptions {
  attributes?: Record<string, string | number | boolean>;
}

export interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: OTelSpanStatus): void;
  recordException(error: Error | string): void;
  end(): void;
}

export interface OTelSpanStatus {
  code: OTelSpanStatusCode;
  message?: string;
}

export enum OTelSpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

/**
 * Configuration for the OTel tracer interceptor.
 */
export interface OTelTracerConfig {
  /**
   * An OTel-compatible TracerProvider (e.g. from @opentelemetry/sdk-node or any OTel-compatible backend).
   * When omitted, the interceptor is a transparent no-op and adds zero overhead.
   */
  tracerProvider?: OTelTracerProvider;

  /**
   * Name used to identify the tracer in OTel (default: 'toolpack-agents').
   */
  tracerName?: string;

  /**
   * Version string attached to the tracer.
   * When omitted, no version is passed to the OTel TracerProvider.
   */
  tracerVersion?: string;

  /**
   * Whether to record workflow step durations as span attributes (default: true).
   */
  recordSteps?: boolean;

  /**
   * Optional: filter which inputs to trace.
   * Return false to skip tracing for a specific input.
   */
  shouldTrace?: (input: AgentInput) => boolean;
}

/**
 * Creates an OTel-compatible tracer interceptor.
 *
 * Emits spans for:
 * - Agent invocation (wraps the entire chain below it)
 * - Each workflow step in the result (if recordSteps is true)
 * - Errors thrown downstream
 *
 * Works with any OTel-compatible backend: Jaeger, Honeycomb, Datadog, OTLP, etc.
 * When no tracerProvider is supplied it is a zero-cost transparent pass-through.
 *
 * @example
 * ```ts
 * import { NodeTracerProvider } from '@opentelemetry/sdk-node';
 *
 * const provider = new NodeTracerProvider();
 * provider.register();
 *
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createOTelTracerInterceptor({ tracerProvider: provider }),
 *     ],
 *   },
 * ]);
 * ```
 */
export function createOTelTracerInterceptor(config: OTelTracerConfig = {}): Interceptor {
  const {
    tracerProvider,
    tracerName = 'toolpack-agents',
    tracerVersion,
    recordSteps = true,
    shouldTrace,
  } = config;

  // Acquire the tracer once at construction time, not per-invocation.
  const tracer = tracerProvider?.getTracer(tracerName, tracerVersion);

  return async (input, ctx, next): Promise<InterceptorResult> => {
    // No-op path — cheapest guard first
    if (!tracer) {
      return await next();
    }

    if (shouldTrace && !shouldTrace(input)) {
      return await next();
    }

    const span = tracer.startSpan('agent.invocation');

    span.setAttribute('agent.name', ctx.agent.name);
    span.setAttribute('channel.name', ctx.channel.name ?? 'unknown');
    span.setAttribute('invocation.depth', ctx.invocationDepth);
    if (input.conversationId) span.setAttribute('conversation.id', input.conversationId);
    if (input.intent) span.setAttribute('agent.intent', input.intent);

    const startTime = performance.now();

    try {
      const result = await next();
      const durationMs = performance.now() - startTime;

      span.setAttribute('duration.ms', Math.round(durationMs));

      if (isSkipSentinel(result)) {
        span.setAttribute('result.skipped', true);
        span.setStatus({ code: OTelSpanStatusCode.OK });
      } else {
        span.setAttribute('result.output.length', result.output.length);

        if (recordSteps && result.steps && result.steps.length > 0) {
          span.setAttribute('steps.total', result.steps.length);

          const failedSteps = result.steps.filter(s => s.status === 'failed');
          if (failedSteps.length > 0) {
            span.setAttribute('steps.failed', failedSteps.length);
          }

          result.steps.forEach((step, index) => {
            const prefix = `step.${index}`;
            span.setAttribute(`${prefix}.description`, step.description);
            span.setAttribute(`${prefix}.status`, step.status);
            if (step.result?.duration !== undefined) {
              span.setAttribute(`${prefix}.duration.ms`, step.result.duration);
            }
            if (step.result?.toolsUsed && step.result.toolsUsed.length > 0) {
              span.setAttribute(`${prefix}.tools`, step.result.toolsUsed.join(','));
            }
          });
        }

        span.setStatus({ code: OTelSpanStatusCode.OK });
      }

      return result;
    } catch (error) {
      const durationMs = performance.now() - startTime;

      span.setAttribute('duration.ms', Math.round(durationMs));
      const exception = error instanceof Error ? error : String(error);
      span.recordException(exception);
      span.setStatus({
        code: OTelSpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      throw error;
    } finally {
      span.end();
    }
  };
}
