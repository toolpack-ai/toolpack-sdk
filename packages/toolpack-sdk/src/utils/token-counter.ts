/**
 * Token Counting Utilities
 * 
 * Provider-specific token counting for accurate context window management.
 * Supports OpenAI (js-tiktoken), Anthropic, Gemini, and Ollama with fallback estimation.
 */

import { Message } from '../types/index.js';

// ============================================================================
// Token Encoding Initialization (lazy-loaded)
// ============================================================================

let tiktoken: any = null;

async function initTiktoken() {
    if (!tiktoken) {
        try {
            const mod = await import('js-tiktoken');
            tiktoken = mod;
        } catch {
            // tiktoken not available, will use fallback
        }
    }
    return tiktoken;
}

// ============================================================================
// OpenAI Token Counting (js-tiktoken)
// ============================================================================

const TOKENS_PER_MESSAGE: Record<string, number> = {
    'gpt-4.1': 3,
    'gpt-4.1-mini': 3,
    'gpt-5.1': 3,
    'gpt-5.2': 3,
    'gpt-5.4': 3,
    'gpt-5.4-pro': 3,
    // Fallback for unknown models
    '__default__': 4,
};

const TOKENS_PER_MESSAGE_SUFFIX = 2;

async function countOpenAITokens(messages: Message[], model: string): Promise<number> {
    try {
        const tiktokenModule = await initTiktoken();
        if (!tiktokenModule) {
            return estimateTokenCount(messages);
        }

        const encoding = tiktokenModule.encoding_for_model(model);
        let totalTokens = 0;

        // Add tokens per message overhead
        const tokensPerMessage = TOKENS_PER_MESSAGE[model] ?? TOKENS_PER_MESSAGE['__default__'];

        for (const message of messages) {
            totalTokens += tokensPerMessage;

            if (typeof message.content === 'string') {
                totalTokens += encoding.encode(message.content).length;
            } else if (Array.isArray(message.content)) {
                for (const part of message.content) {
                    if (part.type === 'text') {
                        totalTokens += encoding.encode((part as any).text).length;
                    } else if (part.type === 'image_data' || part.type === 'image_url' || part.type === 'image_file') {
                        // Estimate image tokens: ~256 tokens + detail
                        totalTokens += 256;
                    }
                }
            }

            if (message.tool_calls?.length) {
                for (const toolCall of message.tool_calls) {
                    totalTokens += encoding.encode(toolCall.function.name).length;
                    totalTokens += encoding.encode(toolCall.function.arguments).length;
                }
            }

            if (message.name) {
                totalTokens += encoding.encode(message.name).length;
            }
        }

        // Add reply tokens overhead
        totalTokens += TOKENS_PER_MESSAGE_SUFFIX;

        return totalTokens;
    } catch (error) {
        // Fallback to estimation if tiktoken fails
        return estimateTokenCount(messages);
    }
}

// ============================================================================
// Anthropic Token Counting
// ============================================================================

async function countAnthropicTokens(messages: Message[], _model: string): Promise<number> {
    try {
        // Anthropic's token counting API would be called here
        // For now, use estimation with slight adjustment for Anthropic's tokenizer
        const baseEstimate = estimateTokenCount(messages);
        // Anthropic tends to count tokens slightly differently, add ~10% margin
        return Math.ceil(baseEstimate * 1.1);
    } catch {
        return estimateTokenCount(messages);
    }
}

// ============================================================================
// Gemini Token Counting
// ============================================================================

async function countGeminiTokens(messages: Message[], _model: string): Promise<number> {
    try {
        // Gemini's token counting would use their API
        // For now, use estimation with adjustment
        const baseEstimate = estimateTokenCount(messages);
        // Gemini's tokenizer is similar to OpenAI but with slight variations
        return Math.ceil(baseEstimate * 1.05);
    } catch {
        return estimateTokenCount(messages);
    }
}

// ============================================================================
// Ollama Token Counting (Estimation)
// ============================================================================

async function countOllamaTokens(messages: Message[], _model: string): Promise<number> {
    // Ollama uses similar tokenization to llama models
    // Use estimation as Ollama doesn't provide token counting API
    const baseEstimate = estimateTokenCount(messages);
    // Llama tokenization tends to be ~1.1x character/4
    return Math.ceil(baseEstimate * 1.05);
}

// ============================================================================
// Fallback: Estimation (chars / 4)
// ============================================================================

export function estimateTokenCount(messages: Message[]): number {
    let totalChars = 0;

    for (const message of messages) {
        // Add overhead for message structure
        totalChars += 50;

        if (typeof message.content === 'string') {
            totalChars += message.content.length;
        } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'text') {
                    totalChars += (part as any).text.length;
                } else if (part.type === 'image_data' || part.type === 'image_url' || part.type === 'image_file') {
                    // Estimate ~1000 chars per image
                    totalChars += 1000;
                }
            }
        }

        if (message.tool_calls?.length) {
            for (const toolCall of message.tool_calls) {
                totalChars += toolCall.function.name.length;
                totalChars += toolCall.function.arguments.length;
            }
        }

        if (message.name) {
            totalChars += message.name.length;
        }
    }

    // Rough estimate: ~4 chars per token (OpenAI/Anthropic standard)
    return Math.ceil(totalChars / 4);
}

// ============================================================================
// Main API: Count tokens for any provider/model
// ============================================================================

export async function countTokens(
    messages: Message[],
    model: string,
    provider: string
): Promise<number> {
    // Normalize provider name
    const normalizedProvider = provider.toLowerCase();

    if (normalizedProvider === 'openai' || normalizedProvider === 'openai-gpt') {
        return countOpenAITokens(messages, model);
    } else if (normalizedProvider === 'anthropic' || normalizedProvider === 'claude') {
        return countAnthropicTokens(messages, model);
    } else if (normalizedProvider === 'gemini' || normalizedProvider === 'google') {
        return countGeminiTokens(messages, model);
    } else if (normalizedProvider === 'ollama') {
        return countOllamaTokens(messages, model);
    } else {
        // Fallback for unknown providers
        return estimateTokenCount(messages);
    }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Calculate if a request would exceed the context window given available space
 */
export function wouldExceedContextWindow(
    currentTokens: number,
    contextWindow: number,
    maxOutputTokens: number
): boolean {
    const availableForInput = contextWindow - maxOutputTokens;
    return currentTokens > availableForInput;
}

/**
 * Calculate percentage of context window used
 */
export function getContextWindowPercentage(
    currentTokens: number,
    contextWindow: number
): number {
    return Math.round((currentTokens / contextWindow) * 100);
}

/**
 * Get safe reserve tokens for output (accounting for overhead)
 */
export function getSafeOutputReserve(maxOutputTokens: number, bufferPercentage: number = 1.15): number {
    // Add 15% buffer by default for overhead (message wrapping, tools, etc.)
    return Math.ceil(maxOutputTokens * bufferPercentage);
}
