import { BaseAgentOptions } from './../agent/types.js';
import { BaseAgent } from '../agent/base-agent.js';
import { AgentInput, AgentResult, type Participant } from '../agent/types.js';
import { CHAT_MODE, type ModeConfig } from 'toolpack-sdk';

// Re-export Participant from core types for back-compat with earlier imports
// from this module. New code should import Participant from 'toolpack-agents'
// (the root) or from '../agent/types.js' directly.
export type { Participant };

/**
 * A message turn in the conversation history.
 */
export interface HistoryTurn {
  /** Unique identifier for this turn */
  id: string;
  /** Participant who sent this message */
  participant: Participant;
  /** The message content */
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Optional metadata about the turn */
  metadata?: {
    /** Whether this was a tool invocation */
    isToolCall?: boolean;
    /** Tool name if applicable */
    toolName?: string;
    /** Tool result if applicable */
    toolResult?: string;
  };
}

/**
 * Input payload for summarization.
 */
export interface SummarizerInput {
  /** The conversation turns to summarize (older messages first) */
  turns: HistoryTurn[];
  /** The target agent's name (for perspective-aware summary) */
  agentName: string;
  /** The agent's unique identifier */
  agentId: string;
  /** Maximum length of the summary in tokens (approximate) */
  maxTokens?: number;
  /** Whether to include action items/decisions in the summary */
  extractDecisions?: boolean;
}

/**
 * Result of a summarization operation.
 */
export interface SummarizerOutput {
  /** The generated summary text */
  summary: string;
  /** Number of turns that were summarized */
  turnsSummarized: number;
  /** Whether decisions/action items were extracted */
  hasDecisions: boolean;
  /** Approximate token count of the summary */
  estimatedTokens: number;
}

/**
 * Capability agent that compresses older conversation history turns
 * into a summary turn for the prompt assembler.
 *
 * Used by the prompt assembler when conversation history exceeds
 * the configured threshold. Returns a compact summary preserving
 * key facts, decisions, and context.
 *
 * Register this agent with an empty channels list to use it as a capability.
 *
 * @example
 * ```ts
 * const summarizer = new SummarizerAgent(toolpack);
 * const result = await summarizer.invokeAgent({
 *   message: 'summarize',
 *   data: {
 *     turns: olderTurns,
 *     agentName: 'name',
 *     agentId: 'U123',
 *     maxTokens: 500,
 *     extractDecisions: true
 *   } as SummarizerInput
 * });
 * const summary = JSON.parse(result.output) as SummarizerOutput;
 * ```
 */
const SUMMARIZER_MODE: ModeConfig = {
  ...CHAT_MODE,
  name: 'summarizer-mode',
  systemPrompt: [
    'You are a conversation summarizer for multi-participant chat histories.',
    'Your job is to compress older conversation turns into a dense summary that preserves:',
    '',
    '1. Key facts and information shared',
    '2. Decisions made or action items assigned',
    '3. Context relevant to the target agent\'s perspective',
    '4. Important questions asked or problems raised',
    '',
    'Summarize from the perspective of the target agent.',
    'If the agent was not addressed in a turn, note it as observed context.',
    'Use bullet points for clarity. Be concise but complete.',
    '',
    'Output format: Return ONLY a JSON object with these fields:',
    '- summary: string (the summary text)',
    '- turnsSummarized: number (count of turns processed)',
    '- hasDecisions: boolean (whether any decisions/action items were found)',
    '- estimatedTokens: number (rough estimate: characters / 4)',
    '',
    'Do not include markdown code blocks, just the raw JSON.'
  ].join('\n'),
};

export class SummarizerAgent extends BaseAgent {
  name = 'summarizer';
  description = 'Compresses conversation history into compact summaries for prompt assembly';
  mode = SUMMARIZER_MODE;

  constructor(options: BaseAgentOptions) {
    super(options);
  }

  async invokeAgent(input: AgentInput): Promise<AgentResult> {
    const payload = input.data as SummarizerInput | undefined;

    if (!payload?.turns || payload.turns.length === 0) {
      return {
        output: JSON.stringify({
          summary: '(No history to summarize)',
          turnsSummarized: 0,
          hasDecisions: false,
          estimatedTokens: 5
        } as SummarizerOutput),
        metadata: { emptyInput: true }
      };
    }

    const maxTokens = payload.maxTokens ?? 800;
    const extractDecisions = payload.extractDecisions ?? true;

    // Build the prompt
    const promptLines: string[] = [
      `Target agent: "${payload.agentName}" (ID: ${payload.agentId})`,
      `Maximum summary length: ~${maxTokens} tokens`,
      `Extract decisions/action items: ${extractDecisions ? 'yes' : 'no'}`,
      '',
      `Conversation turns to summarize (${payload.turns.length} turns):`,
      ''
    ];

    // Format turns chronologically
    for (const turn of payload.turns) {
      const timestamp = new Date(turn.timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const participantName = turn.participant.displayName ?? turn.participant.id;
      const participantLabel = turn.participant.kind === 'agent' ? `[BOT] ${participantName}` : participantName;
      let line = `[${timestamp}] ${participantLabel}: ${turn.content.substring(0, 200)}`;
      if (turn.content.length > 200) {
        line += '...';
      }

      if (turn.metadata?.isToolCall && turn.metadata.toolName) {
        line += ` [tool: ${turn.metadata.toolName}]`;
      }

      promptLines.push(line);
    }

    promptLines.push('', 'Generate a JSON summary object:');

    const prompt = promptLines.join('\n');

    // Note: per-run mode override reserved for future use (currently uses agent mode)
    const result = await this.run(prompt);

    // Parse and validate the output
    const parsed = this.parseSummarizerOutput(result.output, payload.turns.length);

    return {
      output: JSON.stringify(parsed),
      metadata: {
        turnsProcessed: payload.turns.length,
        rawOutputLength: result.output.length
      }
    };
  }

  /**
   * Parse and validate the LLM output into a SummarizerOutput.
   */
  private parseSummarizerOutput(output: string, turnCount: number): SummarizerOutput {
    // Try to extract JSON if wrapped in markdown
    let jsonText = output.trim();

    // Remove markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonText) as Partial<SummarizerOutput>;

      // Validate and provide defaults
      return {
        summary: typeof parsed.summary === 'string' && parsed.summary.length > 0
          ? parsed.summary
          : this.generateFallbackSummary(turnCount),
        turnsSummarized: typeof parsed.turnsSummarized === 'number'
          ? parsed.turnsSummarized
          : turnCount,
        hasDecisions: typeof parsed.hasDecisions === 'boolean'
          ? parsed.hasDecisions
          : false,
        estimatedTokens: typeof parsed.estimatedTokens === 'number' && parsed.estimatedTokens > 0
          ? parsed.estimatedTokens
          : Math.ceil(output.length / 4)
      };
    } catch {
      // JSON parsing failed - use fallback
      return {
        summary: this.generateFallbackSummary(turnCount),
        turnsSummarized: turnCount,
        hasDecisions: output.toLowerCase().includes('decision') || output.toLowerCase().includes('action'),
        estimatedTokens: Math.ceil(output.length / 4)
      };
    }
  }

  /**
   * Generate a fallback summary when parsing fails.
   */
  private generateFallbackSummary(turnCount: number): string {
    return `(Summary of ${turnCount} conversation turns - key details preserved in full context)`;
  }
}
