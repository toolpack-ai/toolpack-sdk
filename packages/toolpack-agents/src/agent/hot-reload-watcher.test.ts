import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { HotReloadWatcher, type WatchFn, type SpawnFn } from './hot-reload-watcher.js';

// ---------------------------------------------------------------------------
// Minimal fake ChildProcess.
// ---------------------------------------------------------------------------
class FakeProcess extends EventEmitter {
  stderr = new EventEmitter();
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Returns a watchFn that captures the listener so tests can trigger file
 * changes, plus a `closed` array tracking whether each watcher was closed.
 */
function makeWatchFn(): {
  watchFn: WatchFn;
  trigger: (filename: string) => void;
  closed: boolean[];
} {
  const closed: boolean[] = [];
  let capturedListener: ((event: string, filename: string | null) => void) | undefined;

  const watchFn: WatchFn = (_path, _opts, listener) => {
    capturedListener = listener;
    const idx = closed.length;
    closed.push(false);
    return { close: () => { closed[idx] = true; } };
  };

  const trigger = (filename: string) => {
    capturedListener?.('change', filename);
  };

  return { watchFn, trigger, closed };
}

/**
 * Returns a spawnFn that emits 'close' (and optionally stderr 'data') via
 * setImmediate AFTER spawnFn is called — so listeners are always attached
 * before the events fire.
 */
function makeSpawnFn(exitCode = 0, stderrData = ''): SpawnFn {
  return () => {
    const proc = new FakeProcess();
    setImmediate(() => {
      if (stderrData) proc.stderr.emit('data', Buffer.from(stderrData));
      proc.emit('close', exitCode);
    });
    return proc as unknown as ReturnType<SpawnFn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HotReloadWatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('file watcher registration', () => {
    it('calls watchFn for each watchPath', () => {
      const { watchFn } = makeWatchFn();
      const mockWatchFn = vi.fn(watchFn);

      const watcher = new HotReloadWatcher({
        watchPaths: ['/project/src', '/project/.env'],
        onRestartNeeded: vi.fn(),
        watchFn: mockWatchFn,
      });

      watcher.start();

      expect(mockWatchFn).toHaveBeenCalledTimes(2);
      expect(mockWatchFn).toHaveBeenCalledWith('/project/src', { recursive: true }, expect.any(Function));
      expect(mockWatchFn).toHaveBeenCalledWith('/project/.env', { recursive: true }, expect.any(Function));
      watcher.stop();
    });

    it('stop() closes all watchers and clears the debounce timer', () => {
      vi.useFakeTimers();
      const { watchFn, trigger, closed } = makeWatchFn();
      const onRestartNeeded = vi.fn();

      const watcher = new HotReloadWatcher({
        watchPaths: ['/src'],
        onRestartNeeded,
        watchFn,
      });

      watcher.start();
      trigger('agent.ts'); // starts debounce timer
      watcher.stop();      // clears timer + closes watcher

      expect(closed[0]).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(onRestartNeeded).not.toHaveBeenCalled();
    });
  });

  describe('debounce', () => {
    it('collapses multiple rapid changes into a single compile', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const mockSpawn = vi.fn(makeSpawnFn(0));
      const onRestartNeeded = vi.fn();

      const watcher = new HotReloadWatcher({
        watchPaths: ['/src'],
        debounceMs: 500,
        onRestartNeeded,
        spawnFn: mockSpawn,
        watchFn,
      });
      watcher.start();

      // Fire 5 rapid changes — each resets the debounce timer.
      trigger('a.ts');
      trigger('b.ts');
      trigger('c.ts');
      trigger('d.ts');
      trigger('e.ts');

      // Still within the debounce window — no compile yet.
      await vi.advanceTimersByTimeAsync(400);
      expect(mockSpawn).not.toHaveBeenCalled();

      // Past the debounce window — exactly one compile.
      await vi.advanceTimersByTimeAsync(200);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      watcher.stop();
    });
  });

  describe('.ts file changes', () => {
    it('calls spawnFn with tsc --build after debounce', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const mockSpawn = vi.fn(makeSpawnFn(0));

      const watcher = new HotReloadWatcher({
        watchPaths: ['/src'],
        cwd: '/project',
        debounceMs: 500,
        onRestartNeeded: vi.fn(),
        spawnFn: mockSpawn,
        watchFn,
      });
      watcher.start();

      trigger('agent/base-agent.ts');
      await vi.advanceTimersByTimeAsync(600);

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['tsc', '--build'],
        expect.objectContaining({ cwd: '/project' }),
      );
      watcher.stop();
    });

    it('calls onRestartNeeded after a successful compile', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const onRestartNeeded = vi.fn();

      const watcher = new HotReloadWatcher({
        watchPaths: ['/src'],
        onRestartNeeded,
        spawnFn: makeSpawnFn(0),
        watchFn,
      });
      watcher.start();

      trigger('foo.ts');
      await vi.advanceTimersByTimeAsync(600); // fires debounce → spawnFn called → setImmediate queued
      await vi.runAllTimersAsync();            // flushes setImmediate → close(0) → onRestartNeeded

      expect(onRestartNeeded).toHaveBeenCalledTimes(1);
      watcher.stop();
    });

    it('calls onCompileError and NOT onRestartNeeded when compile fails', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const onRestartNeeded = vi.fn();
      const onCompileError = vi.fn();

      const watcher = new HotReloadWatcher({
        watchPaths: ['/src'],
        onRestartNeeded,
        onCompileError,
        spawnFn: makeSpawnFn(1, 'Type error on line 42'),
        watchFn,
      });
      watcher.start();

      trigger('broken.ts');
      await vi.advanceTimersByTimeAsync(600);
      await vi.runAllTimersAsync();

      expect(onRestartNeeded).not.toHaveBeenCalled();
      expect(onCompileError).toHaveBeenCalledWith(expect.stringContaining('Type error on line 42'));
      watcher.stop();
    });

    it('ignores non-.ts, non-.env files', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const mockSpawn = vi.fn();
      const onRestartNeeded = vi.fn();

      const watcher = new HotReloadWatcher({
        watchPaths: ['/src'],
        onRestartNeeded,
        spawnFn: mockSpawn as unknown as SpawnFn,
        watchFn,
      });
      watcher.start();

      trigger('README.md');
      trigger('schema.json');
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(onRestartNeeded).not.toHaveBeenCalled();
      watcher.stop();
    });
  });

  describe('.env file changes', () => {
    it('calls onRestartNeeded directly without compiling', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const mockSpawn = vi.fn();
      const onRestartNeeded = vi.fn();

      const watcher = new HotReloadWatcher({
        watchPaths: ['/project'],
        debounceMs: 500,
        onRestartNeeded,
        spawnFn: mockSpawn as unknown as SpawnFn,
        watchFn,
      });
      watcher.start();

      trigger('.env');
      await vi.advanceTimersByTimeAsync(600);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(onRestartNeeded).toHaveBeenCalledTimes(1);
      watcher.stop();
    });

    it('treats .env.local and .env.production as env files', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const mockSpawn = vi.fn();
      const onRestartNeeded = vi.fn();

      const watcher = new HotReloadWatcher({
        watchPaths: ['/project'],
        debounceMs: 500,
        onRestartNeeded,
        spawnFn: mockSpawn as unknown as SpawnFn,
        watchFn,
      });
      watcher.start();

      trigger('.env.local');
      await vi.advanceTimersByTimeAsync(600);
      trigger('.env.production');
      await vi.advanceTimersByTimeAsync(600);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(onRestartNeeded).toHaveBeenCalledTimes(2);
      watcher.stop();
    });
  });

  describe('spawn error handling', () => {
    it('calls onCompileError when spawn emits an error event', async () => {
      vi.useFakeTimers();
      const { watchFn, trigger } = makeWatchFn();
      const onRestartNeeded = vi.fn();
      const onCompileError = vi.fn();

      const proc = new FakeProcess();
      const spawnFn: SpawnFn = () => {
        setImmediate(() => proc.emit('error', new Error('ENOENT: npx not found')));
        return proc as unknown as ReturnType<SpawnFn>;
      };

      const watcher = new HotReloadWatcher({
        watchPaths: ['/src'],
        onRestartNeeded,
        onCompileError,
        spawnFn,
        watchFn,
      });
      watcher.start();

      trigger('agent.ts');
      await vi.advanceTimersByTimeAsync(600);
      await vi.runAllTimersAsync();

      expect(onRestartNeeded).not.toHaveBeenCalled();
      expect(onCompileError).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
      watcher.stop();
    });
  });
});
