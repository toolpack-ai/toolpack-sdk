import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';

/**
 * LRU cache for rate limit buckets.
 * Prevents unbounded memory growth in high-traffic scenarios.
 */
class LRUCache<T> {
  private cache: Map<string, T> = new Map();

  constructor(private maxSize: number) {}

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: T): void {
    // If key exists, delete it first to move to end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest (first item)
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
 * Token bucket for rate limiting.
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number, // tokens per second
    private refillInterval: number // milliseconds
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor((elapsed / this.refillInterval) * this.refillRate);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Configuration for the rate limit interceptor.
 */
export interface RateLimitConfig {
  /** Tokens per interval (default: 10) */
  tokensPerInterval?: number;

  /** Interval in milliseconds (default: 60000 = 1 minute) */
  interval?: number;

  /** Maximum number of buckets to cache (default: 1000). LRU eviction when exceeded. */
  maxBuckets?: number;

  /** Function to extract rate limit key from input (e.g., user ID, conversation ID) */
  getKey: (input: AgentInput) => string;

  /** Behavior when rate limit exceeded: 'skip' silently or 'reject' with error (default: 'skip') */
  onExceeded?: 'skip' | 'reject';

  /** Optional callback when rate limit is hit */
  onRateLimited?: (key: string, input: AgentInput) => void;
}

/**
 * Creates a rate limit interceptor.
 *
 * Token-bucket rate limiting per user or conversation.
 * Skips or rejects when rate exceeded.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createRateLimitInterceptor({
 *         getKey: (input) => input.context?.userId as string || 'default',
 *         tokensPerInterval: 5,
 *         interval: 60000, // 5 messages per minute per user
 *         onExceeded: 'skip'
 *       })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createRateLimitInterceptor(config: RateLimitConfig): Interceptor {
  const tokensPerInterval = config.tokensPerInterval ?? 10;
  const interval = config.interval ?? 60000;
  const maxBuckets = config.maxBuckets ?? 1000;
  const onExceeded = config.onExceeded ?? 'skip';

  // LRU bucket cache per key to prevent unbounded memory growth
  const buckets = new LRUCache<TokenBucket>(maxBuckets);

  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    const key = config.getKey(input);

    // Get or create bucket for this key
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(tokensPerInterval, tokensPerInterval, interval);
      buckets.set(key, bucket);
    }

    if (!bucket.consume()) {
      // Rate limit exceeded
      config.onRateLimited?.(key, input);
      ctx.logger?.warn(`Rate limit exceeded for key: ${key}`, { key });

      if (onExceeded === 'reject') {
        throw new Error(`Rate limit exceeded. Please try again later.`);
      }

      return ctx.skip();
    }

    return await next();
  };
}
