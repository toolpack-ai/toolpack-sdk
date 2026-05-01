import { describe, it, expect } from 'vitest';
import { estimateTokenCount, getContextWindowPercentage, getSafeOutputReserve, wouldExceedContextWindow } from '../../src/utils/token-counter';
import { Message } from '../../src/types/index';

describe('Token Counter Utilities', () => {
    describe('estimateTokenCount', () => {
        it('should estimate tokens from simple text content', () => {
            const messages: Message[] = [
                { role: 'user', content: 'Hello world' }
            ];
            const tokens = estimateTokenCount(messages);
            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBeLessThan(100);
        });

        it('should handle empty messages', () => {
            const messages: Message[] = [];
            const tokens = estimateTokenCount(messages);
            expect(tokens).toBe(0);
        });

        it('should estimate tokens from system messages', () => {
            const messages: Message[] = [
                { role: 'system', content: 'You are a helpful assistant' },
                { role: 'user', content: 'How are you?' }
            ];
            const tokens = estimateTokenCount(messages);
            expect(tokens).toBeGreaterThan(0);
        });

        it('should handle multipart content with text', () => {
            const messages: Message[] = [
                { role: 'user', content: [{ type: 'text', text: 'Hello world' }] }
            ];
            const tokens = estimateTokenCount(messages);
            expect(tokens).toBeGreaterThan(0);
        });

        it('should estimate image tokens', () => {
            const messages: Message[] = [
                {
                    role: 'user', content: [
                        { type: 'text', text: 'What is this?' },
                        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
                    ]
                }
            ];
            const tokens = estimateTokenCount(messages);
            // Should include text tokens + image estimate (~1000 chars)
            expect(tokens).toBeGreaterThan(250);
        });

        it('should handle tool calls in messages', () => {
            const messages: Message[] = [
                {
                    role: 'assistant',
                    content: 'I will help',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'search', arguments: JSON.stringify({ query: 'example' }) }
                        }
                    ]
                }
            ];
            const tokens = estimateTokenCount(messages);
            expect(tokens).toBeGreaterThan(0);
        });

        it('should handle tool response messages', () => {
            const messages: Message[] = [
                {
                    role: 'tool',
                    content: 'Search result',
                    tool_call_id: 'call-1'
                }
            ];
            const tokens = estimateTokenCount(messages);
            expect(tokens).toBeGreaterThan(0);
        });

        it('should increase linearly with message count', () => {
            const message: Message = { role: 'user', content: 'Test message' };
            const tokens1 = estimateTokenCount([message]);
            const tokens2 = estimateTokenCount([message, message]);
            const tokens3 = estimateTokenCount([message, message, message]);

            expect(tokens2).toBeGreaterThan(tokens1);
            expect(tokens3).toBeGreaterThan(tokens2);
        });
    });

    describe('wouldExceedContextWindow', () => {
        it('should detect when context window would be exceeded', () => {
            const contextWindow = 100;
            const maxOutputTokens = 20;
            const currentTokens = 85; // Would exceed: 85 + 20 > 100

            expect(wouldExceedContextWindow(currentTokens, contextWindow, maxOutputTokens)).toBe(true);
        });

        it('should detect when context window would not be exceeded', () => {
            const contextWindow = 100;
            const maxOutputTokens = 20;
            const currentTokens = 70; // Would not exceed: 70 + 20 < 100

            expect(wouldExceedContextWindow(currentTokens, contextWindow, maxOutputTokens)).toBe(false);
        });

        it('should handle exact boundary', () => {
            const contextWindow = 100;
            const maxOutputTokens = 20;
            const currentTokens = 80; // Exact: 80 + 20 = 100

            expect(wouldExceedContextWindow(currentTokens, contextWindow, maxOutputTokens)).toBe(false);
        });
    });

    describe('getContextWindowPercentage', () => {
        it('should calculate percentage correctly', () => {
            const contextWindow = 100;
            const currentTokens = 50;
            const percentage = getContextWindowPercentage(currentTokens, contextWindow);

            expect(percentage).toBe(50);
        });

        it('should round to nearest integer', () => {
            const contextWindow = 100;
            const currentTokens = 33;
            const percentage = getContextWindowPercentage(currentTokens, contextWindow);

            expect(percentage).toBe(33);
        });

        it('should handle zero tokens', () => {
            const contextWindow = 100;
            const currentTokens = 0;
            const percentage = getContextWindowPercentage(currentTokens, contextWindow);

            expect(percentage).toBe(0);
        });

        it('should handle full context window', () => {
            const contextWindow = 100;
            const currentTokens = 100;
            const percentage = getContextWindowPercentage(currentTokens, contextWindow);

            expect(percentage).toBe(100);
        });
    });

    describe('getSafeOutputReserve', () => {
        it('should apply default buffer percentage', () => {
            const maxOutputTokens = 100;
            const reserve = getSafeOutputReserve(maxOutputTokens);

            // Default buffer is 1.15 (15%)
            expect(reserve).toBe(Math.ceil(100 * 1.15));
            expect(reserve).toBe(115);
        });

        it('should apply custom buffer percentage', () => {
            const maxOutputTokens = 100;
            const bufferPercentage = 1.25;
            const reserve = getSafeOutputReserve(maxOutputTokens, bufferPercentage);

            expect(reserve).toBe(Math.ceil(100 * 1.25));
            expect(reserve).toBe(125);
        });

        it('should handle zero buffer', () => {
            const maxOutputTokens = 100;
            const bufferPercentage = 1.0;
            const reserve = getSafeOutputReserve(maxOutputTokens, bufferPercentage);

            expect(reserve).toBe(100);
        });

        it('should round up fractional results', () => {
            const maxOutputTokens = 97;
            const bufferPercentage = 1.15;
            const reserve = getSafeOutputReserve(maxOutputTokens, bufferPercentage);

            expect(reserve).toBe(112); // ceil(97 * 1.15) = ceil(111.55)
        });
    });
});
