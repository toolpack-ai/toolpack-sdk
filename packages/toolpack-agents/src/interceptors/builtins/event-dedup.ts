import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';

/**
 * LRU cache for tracking seen event IDs.
 * Simple Map-based implementation with size limit.
 */
class LRUCache<T> {
  private cache: Map<string, T> = new Map();

  constructor(private maxSize: number) {}

  has(key: string): boolean {
    return this.cache.has(key);
  }

  set(key: string, value: T): void {
    // If key exists, delete it first to move to end (most recent)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // If at capacity, remove oldest (first item)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Configuration for the event deduplication interceptor.
 */
export interface EventDedupConfig {
  /** Maximum number of event IDs to cache (default: 1000) */
  maxCacheSize?: number;

  /** Function to extract event ID from input. Defaults to input.conversationId */
  getEventId?: (input: AgentInput) => string | undefined;

  /** Optional callback when duplicate is detected */
  onDuplicate?: (eventId: string, input: AgentInput) => void;
}

/**
 * Creates an event deduplication interceptor.
 *
 * Drops duplicate events based on event ID (e.g., Slack retries, webhook redeliveries).
 * Uses an LRU cache to track recently seen event IDs.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createEventDedupInterceptor({ maxCacheSize: 500 })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createEventDedupInterceptor(config: EventDedupConfig = {}): Interceptor {
  const maxCacheSize = config.maxCacheSize ?? 1000;
  const getEventId = config.getEventId ?? ((input: AgentInput) => input.context?.eventId as string | undefined);
  const seenEvents = new LRUCache<boolean>(maxCacheSize);

  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    const eventId = getEventId(input);

    if (eventId) {
      if (seenEvents.has(eventId)) {
        // Duplicate detected - skip silently
        config.onDuplicate?.(eventId, input);
        ctx.logger?.debug(`Event dedup: dropping duplicate event ${eventId}`, { eventId });
        return ctx.skip();
      }

      // Mark as seen
      seenEvents.set(eventId, true);
    }

    return await next();
  };
}
