import type { Toolpack } from 'toolpack-sdk';
import { BaseAgent } from '../agent/base-agent.js';
import type { AgentInput, BaseAgentOptions } from '../agent/types.js';
import { MockChannel } from './mock-channel.js';

/**
 * Configuration for mock responses in createTestAgent.
 */
export interface MockResponse {
  /** String or regex to match against the message */
  trigger: string | RegExp;
  /** The response to return when triggered */
  response: string;
  /** Optional usage metadata */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Options for createTestAgent.
 */
export interface CreateTestAgentOptions {
  /** Mock responses for the toolpack.generate() call */
  mockResponses?: MockResponse[];
  /** Default response when no trigger matches */
  defaultResponse?: string;
  /** Provider name for the mock toolpack */
  provider?: string;
  /** Model name for the mock toolpack */
  model?: string;
}

/**
 * Result from createTestAgent.
 */
export interface TestAgentResult<TAgent extends BaseAgent> {
  /** The agent instance */
  agent: TAgent;
  /** The mock channel wired to the agent */
  channel: MockChannel;
  /** The mock toolpack instance */
  toolpack: Toolpack;
  /** Helper to add more mock responses */
  addMockResponse: (response: MockResponse) => void;
}

/**
 * Creates an agent instance wired to a mock channel and mock toolpack.
 * Perfect for unit testing agents in isolation.
 *
 * @example
 * ```ts
 * const { agent, channel, toolpack } = createTestAgent(CustomerSupportAgent, {
 *   mockResponses: [
 *     { trigger: 'refund', response: 'Refund processed successfully.' },
 *   ],
 * });
 *
 * const result = await agent.invokeAgent({
 *   intent: 'refund_request',
 *   message: 'I want a refund for order #123',
 * });
 *
 * expect(result.output).toBe('Refund processed successfully.');
 * ```
 *
 * @param AgentClass The agent class to instantiate
 * @param options Configuration options
 * @returns Test agent setup with agent, channel, and mock toolpack
 */
export function createTestAgent<TAgent extends BaseAgent>(
  AgentClass: new (options: BaseAgentOptions) => TAgent,
  options: CreateTestAgentOptions = {}
): TestAgentResult<TAgent> {
  const mockResponses: MockResponse[] = [...(options.mockResponses ?? [])];
  const defaultResponse = options.defaultResponse ?? 'Mock AI response';

  // Create mock toolpack
  const toolpack = createMockToolpack(mockResponses, defaultResponse, options.provider, options.model);

  // Create agent instance
  const agent = new AgentClass({ toolpack });

  // Create mock channel
  const channel = new MockChannel();

  // Wire up the channel to the agent manually
  channel.onMessage(async (input: AgentInput) => {
    // Set the agent's internal state as if it came through the registry
    agent._triggeringChannel = channel.name;
    agent._conversationId = input.conversationId;
    agent._isTriggerChannel = false;

    const result = await agent.invokeAgent(input);

    // Send result back through channel
    await channel.send({
      output: result.output,
      metadata: result.metadata,
    });
  });

  channel.listen();

  const addMockResponse = (response: MockResponse) => {
    mockResponses.push(response);
  };

  return {
    agent,
    channel,
    toolpack,
    addMockResponse,
  };
}

/**
 * Creates a mock Toolpack instance for testing.
 */
function createMockToolpack(
  mockResponses: MockResponse[],
  defaultResponse: string,
  defaultProvider = 'openai',
  defaultModel?: string
): Toolpack {
  return {
    generate: async (request: unknown, _providerOverride?: string) => {
      const req = request as {
        messages: Array<{ role: string; content: string }>;
        model?: string;
        tools?: unknown[];
      };

      // Get the last user message
      const lastMessage = req.messages
        .filter(m => m.role === 'user')
        .pop();

      const messageContent = lastMessage?.content ?? '';

      // Find matching mock response
      for (const mock of mockResponses) {
        if (typeof mock.trigger === 'string') {
          if (messageContent.toLowerCase().includes(mock.trigger.toLowerCase())) {
            return {
              content: mock.response,
              usage: mock.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            };
          }
        } else if (mock.trigger instanceof RegExp) {
          if (mock.trigger.test(messageContent)) {
            return {
              content: mock.response,
              usage: mock.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            };
          }
        }
      }

      // Return default response
      return {
        content: defaultResponse,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
    setMode: () => {
      // No-op in tests
    },
    registerMode: () => {
      // No-op in tests
    },
    // Add any other required Toolpack methods as no-ops or mocks
    setProvider: () => {},
    setModel: () => {},
    // Provider and model getters
    get provider() {
      return defaultProvider;
    },
    get model() {
      return defaultModel || 'gpt-4';
    },
  } as unknown as Toolpack;
}

/**
 * Creates a minimal mock Toolpack for simple test cases.
 * Returns the same response for all generate() calls.
 *
 * @example
 * ```ts
 * const toolpack = createMockToolpackSimple('Hello!');
 * const agent = new MyAgent(toolpack);
 * const result = await agent.run('Hi');
 * expect(result.output).toBe('Hello!');
 * ```
 */
export function createMockToolpackSimple(response = 'Mock AI response'): Toolpack {
  return {
    generate: async () => ({
      content: response,
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    setMode: () => {},
    registerMode: () => {},
    setProvider: () => {},
    setModel: () => {},
  } as unknown as Toolpack;
}

/**
 * Creates a mock Toolpack that returns different responses based on a sequence.
 * Useful for testing multi-turn conversations or stateful interactions.
 *
 * @example
 * ```ts
 * const toolpack = createMockToolpackSequence([
 *   'First response',
 *   'Second response',
 *   'Third response',
 * ]);
 *
 * // First call returns 'First response', second call 'Second response', etc.
 * ```
 */
export function createMockToolpackSequence(responses: string[]): Toolpack {
  let callIndex = 0;

  return {
    generate: async () => {
      const response = responses[callIndex] ?? 'No more mock responses';
      callIndex++;
      return {
        content: response,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
    setMode: () => {},
    registerMode: () => {},
    setProvider: () => {},
    setModel: () => {},
  } as unknown as Toolpack;
}
