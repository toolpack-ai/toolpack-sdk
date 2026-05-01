import type { AgentInput, AgentResult, AgentInstance, ChannelInterface } from '../agent/types.js';
import type { IAgentRegistry } from '../agent/types.js';
import {
  type Interceptor,
  type InterceptorContext,
  type NextFunction,
  type InterceptorResult,
  type InterceptorChainConfig,
  SKIP_SENTINEL,
  skip,
} from './types.js';

/**
 * Composed chain of interceptors ready to execute.
 */
export interface ComposedChain {
  /** Execute the chain with the given input */
  execute(input: AgentInput): Promise<InterceptorResult>;
}

/**
 * Error thrown when invocation depth exceeds the configured maximum.
 */
export class InvocationDepthExceededError extends Error {
  constructor(currentDepth: number, maxDepth: number) {
    super(`Invocation depth ${currentDepth} exceeds maximum ${maxDepth}`);
    this.name = 'InvocationDepthExceededError';
  }
}

/**
 * Compose an array of interceptors into an executable chain.
 *
 * The first interceptor in the array is outermost (runs first on way in,
 * last on way out). The final handler invokes the agent directly.
 *
 * @param interceptors Ordered array of interceptors (empty = direct agent call)
 * @param agent The agent to invoke at the end of the chain
 * @param channel The triggering channel
 * @param registry The agent registry
 * @param config Chain configuration
 * @returns Composed chain ready to execute
 *
 * @example
 * ```ts
 * const chain = composeChain(
 *   [eventDedup, noiseFilter, intentClassifier],
 *   agent,
 *   channel,
 *   registry,
 *   { maxInvocationDepth: 5 }
 * );
 * const result = await chain.execute(input);
 * ```
 */
export function composeChain(
  interceptors: Interceptor[],
  agent: AgentInstance,
  channel: ChannelInterface,
  registry: IAgentRegistry | null,
  config: InterceptorChainConfig = {}
): ComposedChain {
  const maxDepth = config.maxInvocationDepth ?? 5;

  return {
    async execute(executeInput: AgentInput): Promise<InterceptorResult> {
      // Create context inside execute to close over the execute-time input
      const createContext = (depth: number): InterceptorContext => ({
        agent,
        channel,
        registry,
        invocationDepth: depth,
        delegateAndWait: async (agentName: string, delegateInput: Partial<AgentInput>) => {
          const nextDepth = depth + 1;
          if (nextDepth > maxDepth) {
            throw new InvocationDepthExceededError(nextDepth, maxDepth);
          }

          if (!registry) {
            throw new Error(`Cannot delegate to "${agentName}": agent is running in standalone mode without a registry`);
          }

          const targetAgent = registry.getAgent(agentName);
          if (!targetAgent) {
            throw new Error(`Agent "${agentName}" not found for delegation`);
          }

          // Build full input with inheritance from original execute input
          const fullInput: AgentInput = {
            message: delegateInput.message ?? '',
            intent: delegateInput.intent,
            data: delegateInput.data,
            context: delegateInput.context,
            // Inherit conversationId from delegate input, then original execute input, then fallback
            conversationId: delegateInput.conversationId
              ?? executeInput.conversationId
              ?? `delegation-${Date.now()}`,
          };

          // Invoke target agent directly (interceptors don't apply on delegate calls)
          return await targetAgent.invokeAgent(fullInput);
        },
        skip,
      });

      const ctx = createContext(0);

      // Build the chain from inside out
      // Start with the final handler (agent invocation)
      let chain: NextFunction = async (overrideInput?: AgentInput) => {
        const effectiveInput = overrideInput ?? executeInput;
        const result = await agent.invokeAgent(effectiveInput);
        return result;
      };

      // Wrap with interceptors in reverse order (so first interceptor is outermost)
      for (let i = interceptors.length - 1; i >= 0; i--) {
        const interceptor = interceptors[i];
        const next = chain;

        chain = async (overrideInput?: AgentInput) => {
          const effectiveInput = overrideInput ?? executeInput;
          return await interceptor(effectiveInput, ctx, next);
        };
      }

      // Execute the chain
      return await chain();
    },
  };
}

/**
 * Execute a chain with the given input, handling the skip sentinel.
 *
 * Returns `null` if the chain was skipped (caller should not send to channel),
 * otherwise returns the AgentResult.
 *
 * @param chain The composed chain
 * @param input The agent input
 * @returns AgentResult or null if skipped
 */
export async function executeChain(
  chain: ComposedChain,
  input: AgentInput
): Promise<AgentResult | null> {
  const result = await chain.execute(input);

  if (result === SKIP_SENTINEL) {
    return null;
  }

  return result;
}
