import { SDKError } from '../errors/index.js';

/**
 * Helpers that make a stop (an AbortSignal) take effect at once, also while a provider call is
 * under way. A provider that does not pass the signal to its own HTTP call keeps that call open
 * in the background, but the caller no longer waits for it.
 */

/** Thrown when a call was stopped by its AbortSignal. `name` is 'AbortError', as for fetch. */
export class AbortedError extends SDKError {
  constructor(message = 'The request was aborted') {
    super(message, 'ABORTED');
    this.name = 'AbortError';
  }
}

/**
 * Resolves or rejects like `promise`, unless `signal` is aborted first: then it rejects with an
 * AbortedError right away. What `promise` does after that is ignored.
 */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(new AbortedError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      reject(new AbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/**
 * Yields what `source` yields, and ends quietly as soon as `signal` is aborted, also while it is
 * waiting for the next item. The source is told to finish, and is not waited for.
 */
export async function* untilAborted<T>(source: AsyncIterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
  if (!signal) {
    yield* source;
    return;
  }
  const iterator = source[Symbol.asyncIterator]();
  // Whether the source ended by itself. If not (a stop, or the reader left early), it is told to
  // finish, so it can clean up, as a plain `for await` over it would have done.
  let ended = false;
  try {
    while (true) {
      const next = await raceAbort(iterator.next(), signal);
      if (next.done) { ended = true; return; }
      yield next.value;
    }
  } catch (error) {
    if (error instanceof AbortedError) return;
    ended = true; // it failed by itself: there is nothing left to finish
    throw error;
  } finally {
    if (!ended) void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}
