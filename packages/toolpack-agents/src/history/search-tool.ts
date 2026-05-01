import type { ConversationStore, ConversationSearchOptions as SearchOptions } from 'toolpack-sdk';

/**
 * Configuration for the conversation search tool.
 */
export interface ConversationSearchToolConfig {
  /**
   * Maximum number of results the tool can return.
   * Prevents the model from expanding context unboundedly.
   * Default: 10.
   */
  maxResults?: number;

  /**
   * Rough token cap for the total search results returned.
   * Results are dropped (whole messages, newest-first) once the running
   * token count would exceed this cap. The first matching message is
   * always included even if it alone exceeds the cap.
   * Default: 2000.
   */
  tokenCap?: number;
}

/**
 * A tool definition compatible with the Toolpack / Anthropic tool-use format.
 */
export interface ConversationSearchTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  /**
   * Execute the tool with the given input.
   * Returns a plain-text result ready to pass back as a tool result message.
   */
  execute: (input: { query: string }) => Promise<string>;
}

/**
 * Creates a conversation search tool that the LLM can call during reasoning.
 *
 * The tool is **scope-locked** — it only searches the provided `conversationId`
 * and never crosses conversation boundaries.
 *
 * Results are **token-capped** — the store truncates content to fit within
 * `tokenCap` so the model cannot expand its context window by searching
 * repeatedly.
 *
 * @param store          The conversation store to search against.
 * @param conversationId The current conversation id (scope lock).
 * @param config         Optional tuning (maxResults, tokenCap).
 *
 * @example
 * ```ts
 * const tool = createConversationSearchTool(store, input.conversationId, {
 *   maxResults: 5,
 *   tokenCap: 1500,
 * });
 *
 * // Pass to the LLM as a tool definition:
 * const response = await llm.chat(messages, { tools: [tool] });
 *
 * // When the model calls the tool:
 * if (response.toolCall?.name === tool.name) {
 *   const result = await tool.execute(response.toolCall.input);
 *   // Feed result back as a tool result message...
 * }
 * ```
 */
export function createConversationSearchTool(
  store: ConversationStore,
  conversationId: string,
  config: ConversationSearchToolConfig = {}
): ConversationSearchTool {
  const maxResults = config.maxResults ?? 10;
  const tokenCap = config.tokenCap ?? 2000;

  const searchOptions: SearchOptions = { limit: maxResults, tokenCap };

  return {
    name: 'search_conversation_history',

    description: [
      'Search the conversation history for messages matching a query.',
      'Use this when you need to recall something specific that was said earlier',
      'in this conversation but is not in your immediate context.',
      'Results are limited to this conversation only.',
    ].join(' '),

    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query — keywords or phrases to look for in the conversation history.',
        },
      },
      required: ['query'],
    },

    execute: async ({ query }: { query: string }): Promise<string> => {
      if (!query || query.trim() === '') {
        return 'Error: query must not be empty.';
      }

      const results = await store.search(
        conversationId,
        query.trim(),
        searchOptions
      );

      if (results.length === 0) {
        return `No messages found matching "${query}".`;
      }

      const lines = results.map(msg => {
        const name = msg.participant.displayName ?? msg.participant.id;
        const label = msg.participant.kind === 'agent' ? `${name} (agent)` : name;
        const date = new Date(msg.timestamp).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `[${date}] ${label}: ${msg.content}`;
      });

      return [
        `Found ${results.length} result(s) for "${query}":`,
        '',
        ...lines,
      ].join('\n');
    },
  };
}
