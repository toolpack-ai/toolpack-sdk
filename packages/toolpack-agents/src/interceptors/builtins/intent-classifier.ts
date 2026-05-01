import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';
import type { IntentClassifierInput, IntentClassification } from '../../capabilities/index.js';

/**
 * Configuration for the intent classifier interceptor.
 */
export interface IntentClassifierInterceptorConfig {
  /** Name of the IntentClassifierAgent in the registry */
  classifierAgentName?: string;

  /** Function to extract message text from input */
  getMessageText: (input: AgentInput) => string | undefined;

  /** Agent's display name for classification context */
  agentName: string;

  /** Agent's unique ID */
  agentId: string;

  /** Sender name for classification context */
  getSenderName: (input: AgentInput) => string;

  /** Channel name for classification context */
  getChannelName: (input: AgentInput) => string;

  /** Check if this is a direct message */
  isDirectMessage?: (input: AgentInput) => boolean;

  /** Optional: Get recent context messages */
  getRecentContext?: (input: AgentInput) => Array<{ sender: string; content: string }>;

  /** Optional callback when classification is made */
  onClassified?: (classification: IntentClassification, input: AgentInput) => void;
}

/**
 * Creates an intent classifier interceptor.
 *
 * Delegates to the IntentClassifierAgent for ambiguous address-check cases.
 * Should be placed AFTER the address-check interceptor.
 *
 * Only runs when address-check result is 'ambiguous' or 'indirect'.
 * Skips response for 'passive' and 'ignore' classifications.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createAddressCheckInterceptor({ agentName: 'Assistant', ... }),
 *       createIntentClassifierInterceptor({
 *         agentName: 'Assistant',
 *         agentId: 'U123456',
 *         getMessageText: (input) => input.message || '',
 *         getSenderName: (input) => input.context?.userName as string || 'Unknown',
 *         getChannelName: (input) => input.context?.channelName as string || 'general',
 *         classifierAgentName: 'intent-classifier' // capability agent name
 *       })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createIntentClassifierInterceptor(config: IntentClassifierInterceptorConfig): Interceptor {
  const classifierAgentName = config.classifierAgentName ?? 'intent-classifier';

  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    // Check if address-check already determined this is direct
    const addressCheck = input.context?._addressCheck as string | undefined;

    // If clearly direct, no need to classify
    if (addressCheck === 'direct') {
      return await next();
    }

    // If clearly ignore or passive, skip silently (no LLM call needed)
    if (addressCheck === 'ignore' || addressCheck === 'passive') {
      config.onClassified?.(addressCheck as 'ignore' | 'passive', input);
      return ctx.skip();
    }

    // For ambiguous or indirect - run intent classifier to determine if agent should respond
    const messageText = config.getMessageText(input) ?? '';

    // Skip empty messages
    if (!messageText.trim()) {
      return await next();
    }

    // Build classifier input
    const classifierInput: IntentClassifierInput = {
      message: messageText,
      agentName: config.agentName,
      agentId: config.agentId,
      senderName: config.getSenderName(input),
      channelName: config.getChannelName(input),
      isDirectMessage: config.isDirectMessage?.(input) ?? false,
      recentContext: config.getRecentContext?.(input),
    };

    try {
      // Delegate to intent classifier agent
      const classifierResult = await ctx.delegateAndWait(classifierAgentName, {
        message: 'classify',
        data: classifierInput,
        conversationId: input.conversationId,
      });

      // Parse classification from result
      const classification = (classifierResult.output as string).trim() as IntentClassification;

      config.onClassified?.(classification, input);
      ctx.logger?.debug(`Intent classified as: ${classification}`, { classification });

      // Enrich input with classification
      const enrichedInput: AgentInput = {
        ...input,
        context: {
          ...input.context,
          _intentClassification: classification,
        },
      };

      // Handle classification result
      switch (classification) {
        case 'direct':
          // Continue to agent
          return await next(enrichedInput);

        case 'indirect':
        case 'passive':
        case 'ignore':
        default:
          // Don't respond
          return ctx.skip();
      }
    } catch (error) {
      // If classification fails, fall back to allowing the message
      ctx.logger?.error('Intent classification failed, allowing message', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return await next();
    }
  };
}
