import { RateLimitError } from '../errors/index.js';

export interface RetryOptions {
  /** Maximum number of retry attempts after the first failure. Default: 3 */
  maxRetries?: number;
  /** Delay in ms for each retry attempt. Falls back to the last value if attempts exceed the array length. Default: [10_000, 30_000, 60_000] */
  backoffMs?: number[];
  /** Override which errors are retryable. Defaults to RateLimitError only. */
  isRetryable?: (error: any) => boolean;
  /** Called before each retry so callers can log or instrument. */
  onRetry?: (attempt: number, delayMs: number, error: any) => void;
}

/**
 * Retry an async operation on transient errors with configurable backoff.
 * By default retries on RateLimitError (429), using the error's retryAfter
 * value when present, falling back to the configured backoffMs schedule.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    backoffMs = [10_000, 30_000, 60_000],
    isRetryable = (err) => err instanceof RateLimitError,
    onRetry,
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (isRetryable(error) && attempt < maxRetries) {
        const delay = error?.retryAfter != null
          ? error.retryAfter * 1000
          : (backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 60_000);
        onRetry?.(attempt + 1, delay, error);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  // Unreachable — loop always returns or throws — but satisfies the type checker.
  throw new RateLimitError('Rate limit retries exhausted');
}
