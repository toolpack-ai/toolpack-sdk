/**
 * Message Pruning Utilities
 * 
 * Implements strategies for removing messages from conversation history
 * to stay within context window limits.
 */

import { Message, TextPart } from '../types/index.js';

export interface PruneResult {
    removed: number; // number of messages removed
    tokensReclaimed: number; // estimated tokens freed
    newTotal: number; // total tokens after pruning
    pruneInfo: {
        beforeCount: number;
        afterCount: number;
        removedMessages: Message[];
    };
}

/**
 * Remove oldest messages to reclaim tokens
 * 
 * Strategy: Remove oldest user/assistant pairs first, keeping system messages always
 */
export function pruneMessages(
    messages: Message[],
    targetTokens: number,
    retainSystemMessages: boolean = true
): PruneResult {
    const beforeCount = messages.length;
    const removedMessages: Message[] = [];
    let tokensReclaimed = 0;

    // Identify which messages are safe to remove
    const prunableMessages: Array<{ index: number; message: Message }> = [];
    
    messages.forEach((msg, idx) => {
        // Keep system messages if requested
        if (retainSystemMessages && msg.role === 'system') {
            return;
        }
        
        // Keep tool results as they're linked to assistant messages
        if (msg.role === 'tool') {
            return;
        }

        prunableMessages.push({ index: idx, message: msg });
    });

    // Remove oldest prunable messages until target is met
    for (const { message } of prunableMessages) {
        if (tokensReclaimed >= targetTokens) break;

        // Estimate tokens in this message
        const msgTokens = estimateMessageTokens(message);
        tokensReclaimed += msgTokens;
        removedMessages.push(message);
    }

    // Remove messages from history (in reverse index order to maintain indices)
    const removeIndices = new Set(removedMessages.map(msg => messages.indexOf(msg)));
    const filteredMessages = messages.filter((_, idx) => !removeIndices.has(idx));

    return {
        removed: removedMessages.length,
        tokensReclaimed,
        newTotal: filteredMessages.length,
        pruneInfo: {
            beforeCount,
            afterCount: filteredMessages.length,
            removedMessages,
        },
    };
}

/**
 * Truncate messages that exceed context window
 */
export function truncateMessage(message: Message, maxTokens: number): Message {
    if (typeof message.content === 'string') {
        // Rough estimate: ~4 chars per token
        const maxChars = maxTokens * 4;
        if (message.content.length <= maxChars) {
            return message;
        }

        const truncated = message.content.substring(0, maxChars);
        const omittedTokens = Math.ceil((message.content.length - maxChars) / 4);

        return {
            ...message,
            content: `${truncated}\n\n[...truncated ${omittedTokens} tokens]`,
        };
    } else if (Array.isArray(message.content)) {
        // For multipart content, remove images and keep text up to limit
        const textParts = message.content.filter(p => p.type === 'text');
        const totalChars = textParts.reduce((sum, p) => sum + ((p as any).text?.length || 0), 0);
        const maxChars = maxTokens * 4;

        if (totalChars <= maxChars) {
            return message;
        }

        let charCount = 0;
        const keptParts: TextPart[] = [];

        for (const part of textParts) {
            if (part.type === 'text') {
                const remaining = maxChars - charCount;
                if (remaining <= 0) break;

                const txt = part.text;
                if (txt.length <= remaining) {
                    keptParts.push(part);
                    charCount += txt.length;
                } else {
                    const truncated = txt.substring(0, remaining);
                    const omittedTokens = Math.ceil((txt.length - remaining) / 4);
                    keptParts.push({
                        type: 'text',
                        text: `${truncated}\n\n[...truncated ${omittedTokens} tokens]`,
                    });
                    break;
                }
            }
        }

        return {
            ...message,
            content: keptParts.length > 0 ? keptParts : message.content,
        };
    }

    return message;
}

/**
 * Estimate tokens in a single message (for pruning calculations)
 */
function estimateMessageTokens(message: Message): number {
    // Base overhead for message structure
    let tokens = 4;

    if (typeof message.content === 'string') {
        tokens += Math.ceil(message.content.length / 4);
    } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
            if (part.type === 'text') {
                tokens += Math.ceil(((part as any).text?.length || 0) / 4);
            } else if (part.type === 'image_data' || part.type === 'image_url' || part.type === 'image_file') {
                // Rough estimate for images
                tokens += 256;
            }
        }
    }

    // Add tokens for tool calls
    if (message.tool_calls?.length) {
        for (const tc of message.tool_calls) {
            tokens += Math.ceil(tc.function.name.length / 4);
            tokens += Math.ceil(tc.function.arguments.length / 4);
        }
    }

    // Add name tokens
    if (message.name) {
        tokens += Math.ceil(message.name.length / 4);
    }

    return tokens;
}

/**
 * Group messages by type for analysis
 */
export function groupMessagesByRole(messages: Message[]): Record<string, Message[]> {
    const groups: Record<string, Message[]> = {
        system: [],
        user: [],
        assistant: [],
        tool: [],
    };

    messages.forEach(msg => {
        groups[msg.role] ??= [];
        groups[msg.role].push(msg);
    });

    return groups;
}

/**
 * Get summary stats about messages
 */
export function getMessageStats(messages: Message[]): {
    totalMessages: number;
    totalTokens: number;
    byRole: Record<string, number>;
    largestMessageTokens: number;
} {
    let totalTokens = 0;
    const byRole: Record<string, number> = {};
    let largestMessageTokens = 0;

    for (const msg of messages) {
        const msgTokens = estimateMessageTokens(msg);
        totalTokens += msgTokens;
        largestMessageTokens = Math.max(largestMessageTokens, msgTokens);

        byRole[msg.role] ??= 0;
        byRole[msg.role]++;
    }

    return {
        totalMessages: messages.length,
        totalTokens,
        byRole,
        largestMessageTokens,
    };
}
