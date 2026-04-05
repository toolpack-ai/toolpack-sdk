import { CompletionRequest } from '../types/index.js';

/**
 * Extract the last user message text from a completion request.
 * Handles both string content and multi-part content arrays.
 */
export function extractLastUserText(messages: CompletionRequest['messages']): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m: any = messages[i];
        if (m?.role !== 'user') continue;
        const c = m?.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
            return c
                .map((p: any) => (p?.type === 'text' ? p.text : ''))
                .filter(Boolean)
                .join('\n');
        }
        return '';
    }
    return '';
}
