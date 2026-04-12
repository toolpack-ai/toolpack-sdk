import { BaseAgent } from '../agent/base-agent.js';

export type AgentEventName = 'agent:start' | 'agent:complete' | 'agent:error';

export interface CapturedEvent {
  name: AgentEventName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timestamp: number;
}

export interface EventCapture {
  /** All captured events */
  events: CapturedEvent[];

  /** Number of events captured */
  count: number;

  /** Clear all captured events */
  clear(): void;

  /** Stop capturing events and remove listeners */
  stop(): void;

  /** Check if an event with the given name was captured */
  hasEvent(name: AgentEventName): boolean;

  /** Get all events with the given name */
  getEvents(name: AgentEventName): CapturedEvent[];

  /** Get the first event with the given name, or undefined if none */
  getFirstEvent(name: AgentEventName): CapturedEvent | undefined;

  /** Get the last event with the given name, or undefined if none */
  getLastEvent(name: AgentEventName): CapturedEvent | undefined;

  /** Assert that an event was captured (throws if not) */
  assertEvent(name: AgentEventName): void;

  /** Assert that an event was NOT captured (throws if it was) */
  assertNoEvent(name: AgentEventName): void;
}

/**
 * Captures events emitted by a BaseAgent during testing.
 * Useful for asserting that certain lifecycle events were fired.
 *
 * @example
 * ```ts
 * const { agent } = createTestAgent(MyAgent);
 * const events = captureEvents(agent);
 *
 * await agent.invokeAgent({ message: 'Do something' });
 *
 * expect(events.hasEvent('agent:start')).toBe(true);
 * expect(events.hasEvent('agent:complete')).toBe(true);
 * expect(events.hasEvent('agent:error')).toBe(false);
 *
 * // Or use assertion helpers
 * events.assertEvent('agent:start');
 * events.assertEvent('agent:complete');
 * events.assertNoEvent('agent:error');
 * ```
 *
 * @param agent The agent to capture events from
 * @returns Event capture object with assertion helpers
 */
export function captureEvents(agent: BaseAgent): EventCapture {
  const events: CapturedEvent[] = [];
  const listeners: Array<{ event: AgentEventName; handler: (...args: unknown[]) => void }> = [];

  const createHandler = (eventName: AgentEventName) => {
    return (data: unknown) => {
      events.push({
        name: eventName,
        data,
        timestamp: Date.now(),
      });
    };
  };

  // Attach listeners for all agent events
  const eventNames: AgentEventName[] = ['agent:start', 'agent:complete', 'agent:error'];

  for (const eventName of eventNames) {
    const handler = createHandler(eventName);
    agent.on(eventName, handler);
    listeners.push({ event: eventName, handler });
  }

  return {
    get events() {
      return [...events];
    },

    get count() {
      return events.length;
    },

    clear() {
      events.length = 0;
    },

    stop() {
      for (const { event, handler } of listeners) {
        agent.off(event, handler);
      }
      listeners.length = 0;
    },

    hasEvent(name: AgentEventName): boolean {
      return events.some(e => e.name === name);
    },

    getEvents(name: AgentEventName): CapturedEvent[] {
      return events.filter(e => e.name === name);
    },

    getFirstEvent(name: AgentEventName): CapturedEvent | undefined {
      return events.find(e => e.name === name);
    },

    getLastEvent(name: AgentEventName): CapturedEvent | undefined {
      const filtered = events.filter(e => e.name === name);
      return filtered[filtered.length - 1];
    },

    assertEvent(name: AgentEventName): void {
      if (!this.hasEvent(name)) {
        const capturedEventNames = events.map(e => e.name).join(', ') || '(none)';
        throw new Error(`captureEvents: expected event "${name}" was not captured. Captured events: ${capturedEventNames}`);
      }
    },

    assertNoEvent(name: AgentEventName): void {
      if (this.hasEvent(name)) {
        const count = events.filter(e => e.name === name).length;
        throw new Error(`captureEvents: unexpected event "${name}" was captured ${count} time(s)`);
      }
    },
  };
}

/**
 * Custom Vitest/Jest matcher for asserting captured events.
 * Add this to your test setup for more readable assertions.
 *
 * @example
 * ```ts
 * // In your test setup file
 * import { expect } from 'vitest';
 * import { registerEventMatchers } from '@toolpack-sdk/agents/testing';
 * registerEventMatchers(expect);
 *
 * // In your tests
 * expect(events).toContainEvent('agent:start');
 * expect(events).not.toContainEvent('agent:error');
 * ```
 */
export function registerEventMatchers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect: { extend: (matchers: Record<string, (...args: unknown[]) => { message: () => string; pass: boolean }>) => void }
): void {
  expect.extend({
    toContainEvent(...args: unknown[]) {
      const received = args[0] as EventCapture;
      const expectedEvent = args[1] as AgentEventName;
      const pass = received.hasEvent(expectedEvent);
      return {
        message: () =>
          pass
            ? `expected events to NOT contain "${expectedEvent}"`
            : `expected events to contain "${expectedEvent}". Captured events: ${received.events.map(e => e.name).join(', ') || '(none)'}`,
        pass,
      };
    },

    toContainEventTimes(...args: unknown[]) {
      const received = args[0] as EventCapture;
      const expectedEvent = args[1] as AgentEventName;
      const times = args[2] as number;
      const count = received.getEvents(expectedEvent).length;
      const pass = count === times;
      return {
        message: () =>
          pass
            ? `expected event "${expectedEvent}" to NOT be captured ${times} time(s), but it was`
            : `expected event "${expectedEvent}" to be captured ${times} time(s), but it was captured ${count} time(s)`,
        pass,
      };
    },
  });
}
