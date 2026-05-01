import type { Message } from '../types/index.js';
import { SDKError } from '../errors/index.js';

function getMessageText(message: Message): string {
  if (message.content == null) {
    return '';
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      if (part.type === 'image_url') {
        return `[image: ${part.image_url.url}]`;
      }

      if (part.type === 'image_file') {
        return `[image-file: ${part.image_file.path}]`;
      }

      if (part.type === 'image_data') {
        return `[image-data: ${part.image_data.mimeType}]`;
      }

      return '';
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Options for summarizing messages
 */
export interface SummarizationOptions {
  /** Model to use for summarization (e.g., 'gpt-4-turbo') */
  model: string;
  /** Maximum tokens for summary (default: 500) */
  maxSummaryTokens?: number;
  /** Whether to preserve exact message boundaries or create coherent summary (default: false) */
  preserveExactMessages?: boolean;
  /** Custom summarization prompt template */
  summaryPrompt?: string;
  /** Custom format for summary marker in message history */
  summaryMarkerFormat?: string;
}

/**
 * Result of a summarization operation
 */
export interface SummarizationResult {
  /** Summary content */
  summary: string;
  /** Number of messages that were summarized */
  messageCount: number;
  /** Approximate tokens in original messages */
  originalTokens: number;
  /** Approximate tokens in summary */
  summaryTokens: number;
  /** Number of tokens saved */
  tokensSaved: number;
  /** Timestamp of summarization */
  timestamp: Date;
}

/**
 * Generates a default summarization prompt for the given messages
 */
export function generateSummarizationPrompt(
  messages: Message[],
  userPrompt?: string
): string {
  if (userPrompt) {
    return userPrompt;
  }

  // Extract conversation context
  const userMessages = messages.filter((m) => m.role === 'user');
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const toolMessages = messages.filter((m) => m.role === 'tool');

  const messageCount = messages.length;
  const userCount = userMessages.length;
  const assistantCount = assistantMessages.length;

  return `Please provide a concise summary of the following conversation history. The conversation contains ${messageCount} messages (${userCount} user messages, ${assistantCount} assistant responses${toolMessages.length > 0 ? `, and ${toolMessages.length} tool responses` : ''}).

Focus on:
1. Key topics discussed
2. Important decisions or conclusions
3. User's intent and goals
4. Relevant context for continuing the conversation

The summary should be comprehensive yet concise, preserving all critical information needed to continue the conversation naturally.

---
CONVERSATION:
${messages.map((m, i) => {
  const content = getMessageText(m);
  return `[Message ${i + 1}] ${m.role.toUpperCase()}: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`;
})
  .join('\n')}
---

SUMMARY:`;
}

/**
 * Creates a system message containing the conversation summary
 */
export function createSummarySystemMessage(summary: string, originalMessageCount: number): Message {
  return {
    role: 'system',
    content: `[Context Summary]
This conversation has been summarized to manage context window. The following is a summary of the first ${originalMessageCount} messages:

${summary}

[End Summary]

Use this summary to understand the conversation context. When responding, acknowledge that you're aware of the previous conversation and continue naturally.`,
  };
}

/**
 * Extracts key information from messages for summarization
 */
export function extractConversationKeypoints(messages: Message[]): {
  topics: string[];
  decisions: string[];
  userGoals: string[];
  context: string;
} {
  const topics: Set<string> = new Set();
  const decisions: string[] = [];
  const userGoals: string[] = [];
  let lastUserMessage = '';

  for (const message of messages) {
    if (message.role === 'user') {
      const content = getMessageText(message);
      lastUserMessage = content;

      // Extract potential goals (sentences ending with ? or containing action words)
      if (content.includes('?')) {
        userGoals.push(content.split('\n')[0]);
      }

      // Extract topics (capitalized phrases)
      const topicMatches = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
      if (topicMatches) {
        topicMatches.forEach((t) => topics.add(t));
      }
    } else if (message.role === 'assistant') {
      const content = getMessageText(message);

      // Extract decisions (sentences with decision markers)
      if (content.includes('decided') || content.includes('concluded') || content.includes('determined')) {
        const sentences = content.split(/[.!?]+/);
        for (const sentence of sentences) {
          if (sentence.includes('decided') || sentence.includes('concluded') || sentence.includes('determined')) {
            decisions.push(sentence.trim());
          }
        }
      }
    }
  }

  return {
    topics: Array.from(topics).slice(0, 10),
    decisions: decisions.slice(0, 5),
    userGoals: userGoals.slice(0, 5),
    context: lastUserMessage.substring(0, 200),
  };
}

/**
 * Estimates tokens in a summary (rough estimation)
 */
export function estimateSummaryTokens(summaryText: string): number {
  // Rough estimation: ~1 token per 4 characters for most text
  return Math.ceil(summaryText.length / 4);
}

/**
 * Validates that a summarization result is sensible
 */
export function validateSummarizationResult(result: SummarizationResult): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!result.summary || result.summary.length < 10) {
    issues.push('Summary is too short');
  }

  if (result.summary.length > 5000) {
    issues.push('Summary is excessively long');
  }

  if (result.messageCount < 2) {
    issues.push('Must summarize at least 2 messages');
  }

  if (result.summaryTokens >= result.originalTokens * 0.8) {
    issues.push('Summary is not significantly shorter than original messages');
  }

  if (result.tokensSaved < 0) {
    issues.push('Token calculation error: saved tokens is negative');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Prepares messages for summarization by the LLM
 * Returns the messages that should be sent to the summarizer model
 */
export function prepareSummarizationRequest(
  messagesToSummarize: Message[],
  options: SummarizationOptions
): Message[] {
  const prompt = generateSummarizationPrompt(messagesToSummarize, options.summaryPrompt);

  // Create a system message that instructs the model to summarize
  const systemMessage: Message = {
    role: 'system',
    content: `You are a conversation summarizer. Your task is to create a clear, concise summary of the provided conversation that preserves all critical information.

Maximum summary length: ${options.maxSummaryTokens || 500} tokens.
Format: Write only the summary without any additional commentary.`,
  };

  // Create the user message with the summarization request
  const userMessage: Message = {
    role: 'user',
    content: prompt,
  };

  return [systemMessage, userMessage];
}

/**
 * Parses the summarization response from the LLM
 */
export function parseSummarizationResponse(
  response: string,
  originalMessages: Message[],
  originalTokenCount: number
): SummarizationResult {
  const summaryTokens = estimateSummaryTokens(response);
  const tokensSaved = Math.max(0, originalTokenCount - summaryTokens);

  return {
    summary: response.trim(),
    messageCount: originalMessages.length,
    originalTokens: originalTokenCount,
    summaryTokens,
    tokensSaved,
    timestamp: new Date(),
  };
}

/**
 * Builds a new message array with summarized history
 */
export function buildSummarizedHistory(
  systemMessages: Message[],
  summarizedContent: SummarizationResult,
  recentMessages: Message[]
): Message[] {
  // Keep system messages as-is
  const result: Message[] = [...systemMessages];

  // Add summary as a system message
  result.push(createSummarySystemMessage(summarizedContent.summary, summarizedContent.messageCount));

  // Add recent messages
  result.push(...recentMessages);

  return result;
}

/**
 * Creates a detailed summarization report
 */
export function createSummarizationReport(
  result: SummarizationResult,
  beforeMessageCount: number,
  afterMessageCount: number
): string {
  const reductionPercent = Math.round((result.tokensSaved / result.originalTokens) * 100);

  return `
Summarization Report
====================
Timestamp: ${result.timestamp.toISOString()}
Status: ✓ Summarization completed

Input Analysis:
- Messages summarized: ${result.messageCount}
- Original token count: ${result.originalTokens}
- Summary token count: ${result.summaryTokens}
- Tokens saved: ${result.tokensSaved} (${reductionPercent}% reduction)

Message Count:
- Before: ${beforeMessageCount} messages
- After: ${afterMessageCount} messages
- Reduction: ${beforeMessageCount - afterMessageCount} messages

Summary Preview:
${result.summary.substring(0, 300)}${result.summary.length > 300 ? '...' : ''}
  `.trim();
}

/**
 * Merges multiple summarization results into one
 */
export function mergeSummarizationResults(results: SummarizationResult[]): SummarizationResult {
  if (results.length === 0) {
    throw new SDKError('Cannot merge empty summarization results', 'CONTEXT_WINDOW_ERROR');
  }

  const merged: SummarizationResult = {
    summary: results.map((r) => `[Round ${results.indexOf(r) + 1}] ${r.summary}`).join('\n\n'),
    messageCount: results.reduce((sum, r) => sum + r.messageCount, 0),
    originalTokens: results.reduce((sum, r) => sum + r.originalTokens, 0),
    summaryTokens: results.reduce((sum, r) => sum + r.summaryTokens, 0),
    tokensSaved: results.reduce((sum, r) => sum + r.tokensSaved, 0),
    timestamp: new Date(),
  };

  return merged;
}
