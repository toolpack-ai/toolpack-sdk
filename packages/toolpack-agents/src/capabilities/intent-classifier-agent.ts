import { BaseAgentOptions } from './../agent/types.js';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult } from '../agent/types.js';
import { CHAT_MODE, type ModeConfig } from 'toolpack-sdk';

/**
 * Input payload for intent classification.
 */
export interface IntentClassifierInput {
  /** The message content to classify */
  message: string;
  /** The agent's display name (e.g., "Assistant") */
  agentName: string;
  /** The agent's unique identifier */
  agentId: string;
  /** The sender's display name */
  senderName: string;
  /** The conversation channel name */
  channelName: string;
  /** Whether this is a direct message (IM) context */
  isDirectMessage?: boolean;
  /** Previous message context (last 3 messages for continuity) */
  recentContext?: Array<{
    sender: string;
    content: string;
  }>;
  /** Whether to include classification examples in the prompt (helps tiny models) */
  includeExamples?: boolean;
}

/**
 * Classification result indicating how the message relates to the target agent.
 */
export type IntentClassification =
  | 'direct'      // Explicitly addressed to the agent (e.g., "@Assistant help me")
  | 'indirect'    // Mentions agent but not clearly requesting response
  | 'passive'     // No addressing, agent should listen but not reply
  | 'ignore';     // Definitely not for this agent (noise, other bot, etc.)

/**
 * Capability agent that classifies whether a message is directly asking
 * the target agent to respond.
 *
 * Used by the intent-classifier interceptor when the rules-based address
 * check is ambiguous. Returns a single-word classification.
 *
 * Register this agent with an empty channels list to use it as a capability.
 *
 * @example
 * ```ts
 * const classifier = new IntentClassifierAgent(toolpack);
 * const result = await classifier.invokeAgent({
 *   message: 'classify',
 *   data: {
 *     message: 'Hey @assistant can you help?',
 *     agentName: 'assistant',
 *     agentId: 'U123',
 *     senderName: 'alice',
 *     channelName: 'general',
 *     isDirectMessage: false
 *   } as IntentClassifierInput
 * });
 * // result.output === 'direct'
 * ```
 */
const INTENT_CLASSIFIER_MODE: ModeConfig = {
  ...CHAT_MODE,
  name: 'intent-classifier-mode',
  systemPrompt: [
    'You classify whether a message is asking an agent to respond.',
    '',
    'Categories:',
    'direct = Message uses @mention, name in greeting, possessive, or commands the agent to act',
    'indirect = Agent is mentioned but unclear if response wanted (talking ABOUT, not TO them)',
    'passive = No addressing detected; agent should only listen, not reply',
    'ignore = Definitely not for this agent (noise, code blocks, other bots)',
    '',
    'Response must start with one of: direct, indirect, passive, ignore'
  ].join('\n'),
};

export class IntentClassifierAgent extends BaseAgent {
  name = 'intent-classifier';
  description = 'Classifies whether a message is directly addressing an agent for response';
  mode = INTENT_CLASSIFIER_MODE;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const payload = input.data as IntentClassifierInput | undefined;

    // DMs are always direct — bypass classification entirely
    if (payload?.isDirectMessage) {
      return {
        output: 'direct',
        metadata: { classification: 'direct', shortCircuit: 'dm' }
      };
    }

    if (!payload?.message) {
      return {
        output: 'ignore',
        metadata: { error: 'No message provided for classification' }
      };
    }

    const contextLines: string[] = [];

    // DM case already short-circuited above; this only runs for channel messages
    contextLines.push(`Context: Public channel #${payload.channelName}`);

    contextLines.push(`Target agent: "${payload.agentName}" (ID: ${payload.agentId})`);
    contextLines.push(`Message sender: ${payload.senderName}`);

    if (payload.recentContext && payload.recentContext.length > 0) {
      contextLines.push('\nRecent conversation:');
      for (const msg of payload.recentContext) {
        contextLines.push(`  ${msg.sender}: ${msg.content.substring(0, 100)}`);
      }
    }

    contextLines.push(`\nMessage to classify: "${payload.message}"`);

    if (payload.includeExamples) {
      contextLines.push('\nExamples of classifications:');
      contextLines.push(`  "@${payload.agentName} help me" → direct`);
      contextLines.push(`  "Can someone ask ${payload.agentName} about this?" → indirect`);
      contextLines.push(`  "I was talking to ${payload.agentName} earlier" → passive`);
      contextLines.push(`  "Check the logs" → ignore`);
    }

    contextLines.push('\nClassification (start with direct, indirect, passive, or ignore):');

    const prompt = contextLines.join('\n');

    // Note: per-run mode override reserved for future use (currently uses agent mode)
    const result = await this.run(prompt);

    // Normalize output to valid classification
    const normalized = this.normalizeClassification(result.output);

    return {
      output: normalized,
      metadata: {
        rawOutput: result.output,
        classification: normalized,
        confidence: 'high' // Could be enhanced with token probabilities in future
      }
    };
  }

  /**
   * Normalize the LLM output to a valid classification.
   */
  private normalizeClassification(output: string): IntentClassification {
    const cleaned = output.toLowerCase().trim().split(/\s+/)[0];
    const fullOutput = output.toLowerCase();

    const validClassifications: IntentClassification[] = ['direct', 'indirect', 'passive', 'ignore'];

    // Exact match on first word
    if (validClassifications.includes(cleaned as IntentClassification)) {
      return cleaned as IntentClassification;
    }

    // Fuzzy fallback: check full output for keywords
    // Order matters: check more specific terms before substring matches
    if (fullOutput.includes('indirect') || fullOutput.includes('mention')) {
      return 'indirect';
    }
    if (fullOutput.includes('passive') || fullOutput.includes('listen')) {
      return 'passive';
    }
    if (fullOutput.includes('ignore') || fullOutput.includes('skip')) {
      return 'ignore';
    }
    if (fullOutput.includes('direct') || fullOutput.includes('addressed')) {
      return 'direct';
    }

    // Default to ignore for any unrecognized output
    return 'ignore';
  }
}
