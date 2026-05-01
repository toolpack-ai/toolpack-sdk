import type { AgentInput } from '../../agent/types.js';
import type { Interceptor, InterceptorContext, InterceptorResult, NextFunction } from '../types.js';

/**
 * Check if the agent's name appears only inside code regions (fenced blocks
 * ``` ``` ``` ``` or inline backticks `` ` ``).
 *
 * Returns true if:
 * - The agent name is inside at least one code region AND
 * - The agent name does NOT appear outside code regions
 *
 * Returns false if:
 * - The agent name is not present at all
 * - There are no code regions
 * - The agent name also appears outside code regions
 */
export function isAgentNameOnlyInCodeBlocks(message: string, agentName: string): boolean {
  const agentNameLower = agentName.toLowerCase();
  const messageLower = message.toLowerCase();

  // Agent name must be present at all
  if (!messageLower.includes(agentNameLower)) {
    return false;
  }

  // Find all code regions: fenced ``` ``` blocks first (multiline), then inline `…`.
  // We collect [start, end) ranges so we can strip by position (handles duplicates).
  const ranges: Array<[number, number]> = [];

  const fencedRegex = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = fencedRegex.exec(message)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  const inlineRegex = /`[^`\n]*`/g;
  while ((m = inlineRegex.exec(message)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // Skip if already covered by a fenced block
    const coveredByFence = ranges.some(([s, e]) => start >= s && end <= e);
    if (!coveredByFence) {
      ranges.push([start, end]);
    }
  }

  // No code regions - not an "only in code" case
  if (ranges.length === 0) {
    return false;
  }

  // Build text outside code regions by stripping ranges in order.
  // Sort ranges ascending and walk through the message collecting gaps.
  ranges.sort((a, b) => a[0] - b[0]);
  let outsideText = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      outsideText += message.slice(cursor, start);
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < message.length) {
    outsideText += message.slice(cursor);
  }

  const outsideCodeBlock = outsideText.toLowerCase().includes(agentNameLower);

  // If it's anywhere outside code regions, it's not "only in code"
  if (outsideCodeBlock) {
    return false;
  }

  // Confirm it's actually inside at least one code region
  const inCodeBlock = ranges.some(([s, e]) =>
    message.slice(s, e).toLowerCase().includes(agentNameLower)
  );

  return inCodeBlock;
}

/**
 * Classification result from address checking.
 */
export type AddressCheckResult =
  | 'direct'      // Clearly addressed to agent (@mention, name in greeting)
  | 'indirect'    // Mentioned but unclear
  | 'passive'     // Not addressed, should listen only
  | 'ignore'      // Definitely not for agent
  | 'ambiguous';  // Needs LLM classification

/**
 * Configuration for the address-check rules interceptor.
 */
export interface AddressCheckConfig {
  /** The agent's display name (e.g., "Assistant") */
  agentName: string;

  /** The agent's ID/slack ID (e.g., "U123456") */
  agentId?: string;

  /** Function to extract message text from input */
  getMessageText: (input: AgentInput) => string | undefined;

  /** Optional: Check if input is a direct message (DM) */
  isDirectMessage?: (input: AgentInput) => boolean;

  /** Optional: Extract mentioned user IDs from message */
  getMentions?: (input: AgentInput) => string[];

  /** Optional callback when classification is made */
  onClassified?: (result: AddressCheckResult, input: AgentInput) => void;
}

/**
 * Creates an address-check rules interceptor.
 *
 * Stage-3 rule-based classifier:
 * - Vocative detection ("Hey Assistant...")
 * - Possessive patterns ("my Assistant...")
 * - Code/URL detection (likely not addressing)
 * - Co-mention detection
 *
 * Returns 'ambiguous' for cases that need LLM classification by intent-classifier.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry([
 *   {
 *     agent: MyAgent,
 *     channels: [slackChannel],
 *     interceptors: [
 *       createAddressCheckInterceptor({
 *         agentName: 'Assistant',
 *         agentId: 'U123456',
 *         getMessageText: (input) => input.message || ''
 *       })
 *     ]
 *   }
 * ]);
 * ```
 */
export function createAddressCheckInterceptor(config: AddressCheckConfig): Interceptor {
  return async (input: AgentInput, ctx: InterceptorContext, next: NextFunction): Promise<InterceptorResult> => {
    const messageText = config.getMessageText(input) ?? '';

    // Check for direct message (always direct)
    if (config.isDirectMessage?.(input)) {
      const enrichedInput: AgentInput = {
        ...input,
        context: {
          ...input.context,
          _addressCheck: 'direct' as AddressCheckResult,
          _isDM: true,
        },
      };
      config.onClassified?.('direct', input);
      return await next(enrichedInput);
    }

    // Rule-based classification
    let result: AddressCheckResult = 'ambiguous';

    const lowerMessage = messageText.toLowerCase();
    const agentNameLower = config.agentName.toLowerCase();
    // Escape regex metacharacters so names like "agent.v2" or "c++" work correctly.
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedName = escapeRegex(agentNameLower);
    const idPart = config.agentId ? `|^@${escapeRegex(config.agentId)}\\b` : '';

    // Check 1: @mention or explicit name in greeting (direct)
    const vocativePattern = new RegExp(`^(hey\\s+)?@?${escapedName}\\b${idPart}`, 'i');
    if (vocativePattern.test(lowerMessage)) {
      result = 'direct';
    }
    // Check 2: Possessive patterns (ambiguous - talking ABOUT the agent, not necessarily TO it)
    // Examples: "the assistant mentioned earlier", "our assistant logged that"
    else if (new RegExp(`\\b(my|our|the)\\s+${escapedName}\\b`, 'i').test(lowerMessage)) {
      result = 'ambiguous';
    }
    // Check 3: Code blocks — only ignore if agent name is EXCLUSIVELY inside code blocks
    // Example: "check this: ```error in kael system```" → ignore (name only in code)
    // Example: "hey kael, here's my error: ```stack trace```" → continue (name outside code)
    else if (isAgentNameOnlyInCodeBlocks(messageText, config.agentName)) {
      result = 'ignore';
    }
    // Check 4: URLs as entire message (ignore)
    else if (/^https?:\/\//.test(messageText)) {
      result = 'ignore';
    }
    // Check 5: Co-mention check (indirect if others mentioned)
    else if (config.getMentions) {
      const mentions = config.getMentions(input);
      const agentMentioned = mentions.some(
        m => m.toLowerCase() === agentNameLower || m === config.agentId
      );
      if (agentMentioned && mentions.length > 1) {
        result = 'indirect';
      } else if (agentMentioned) {
        result = 'ambiguous';
      }
    }
    // Check 6: Simple name mention (ambiguous - needs LLM)
    else if (lowerMessage.includes(agentNameLower)) {
      result = 'ambiguous';
    }
    // No mention detected (passive)
    else {
      result = 'passive';
    }

    // Enrich input with classification result
    const enrichedInput: AgentInput = {
      ...input,
      context: {
        ...input.context,
        _addressCheck: result,
      },
    };

    config.onClassified?.(result, input);
    ctx.logger?.debug(`Address check classified as: ${result}`, { result });

    return await next(enrichedInput);
  };
}
