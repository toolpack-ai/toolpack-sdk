import { describe, it, expect } from 'vitest';
import {
    ContextWindowExceededError,
    InsufficientContextError,
    SummarizationError,
    ContextWindowConfigError,
    ConversationNotFoundError,
    isContextWindowError,
    handleContextWindowError
} from '../../src/errors/context-window-errors';

describe('Context Window Errors', () => {
    describe('ContextWindowExceededError', () => {
        it('should create error with correct properties', () => {
            const error = new ContextWindowExceededError(
                'Context window exceeded',
                'conv-1',
                5000,
                4000,
                'prune'
            );

            expect(error.message).toBe('Context window exceeded');
            expect(error.code).toBe('CONTEXT_WINDOW_EXCEEDED');
            expect(error.conversationId).toBe('conv-1');
            expect(error.currentTokens).toBe(5000);
            expect(error.contextWindowLimit).toBe(4000);
            expect(error.strategy).toBe('prune');
        });

        it('should calculate overage tokens correctly', () => {
            const error = new ContextWindowExceededError(
                'Message',
                'conv-1',
                5000,
                4000,
                'prune'
            );

            expect(error.getOverageTokens()).toBe(1000);
        });

        it('should calculate usage percentage correctly', () => {
            const error = new ContextWindowExceededError(
                'Message',
                'conv-1',
                2000,
                4000,
                'prune'
            );

            expect(error.getUsagePercentage()).toBe(50);
        });

        it('should generate detailed report', () => {
            const error = new ContextWindowExceededError(
                'Test message',
                'conv-1',
                5000,
                4000,
                'fail'
            );

            const report = error.getDetailedReport();

            expect(report).toContain('Context Window Exceeded');
            expect(report).toContain('conv-1');
            expect(report).toContain('5000');
            expect(report).toContain('4000');
            expect(report).toContain('fail');
        });
    });

    describe('InsufficientContextError', () => {
        it('should create error with correct properties', () => {
            const error = new InsufficientContextError(
                'Insufficient context',
                'conv-1',
                1000,
                500,
                800
            );

            expect(error.message).toBe('Insufficient context');
            expect(error.code).toBe('INSUFFICIENT_CONTEXT');
            expect(error.conversationId).toBe('conv-1');
            expect(error.requiredTokens).toBe(1000);
            expect(error.availableTokens).toBe(500);
        });

        it('should calculate deficit correctly', () => {
            const error = new InsufficientContextError(
                'Message',
                'conv-1',
                1000,
                500,
                800
            );

            expect(error.getDeficit()).toBe(500);
        });

        it('should determine recoverability', () => {
            const recoverableError = new InsufficientContextError(
                'Message',
                'conv-1',
                1000,
                500,
                600 // Can recover since 500 >= 600 * 0.5 (300)
            );

            expect(recoverableError.isRecoverable()).toBe(true);

            const nonRecoverableError = new InsufficientContextError(
                'Message',
                'conv-1',
                1000,
                100,
                400 // Cannot recover since 100 < 400 * 0.5 (200)
            );

            expect(nonRecoverableError.isRecoverable()).toBe(false);
        });

        it('should generate detailed report', () => {
            const error = new InsufficientContextError(
                'Test message',
                'conv-1',
                1000,
                500,
                800
            );

            const report = error.getDetailedReport();

            expect(report).toContain('Insufficient Context');
            expect(report).toContain('conv-1');
            expect(report).toContain('1000');
            expect(report).toContain('500');
        });
    });

    describe('SummarizationError', () => {
        it('should create error with correct properties', () => {
            const error = new SummarizationError(
                'Summarization failed',
                'conv-1',
                10,
                'provider_error'
            );

            expect(error.message).toBe('Summarization failed');
            expect(error.code).toBe('SUMMARIZATION_ERROR');
            expect(error.conversationId).toBe('conv-1');
            expect(error.messageCount).toBe(10);
            expect(error.failureReason).toBe('provider_error');
        });

        it('should determine retryability', () => {
            const retryableError = new SummarizationError(
                'Message',
                'conv-1',
                10,
                'provider_error'
            );

            expect(retryableError.isRetryable()).toBe(true);

            const nonRetryableError = new SummarizationError(
                'Message',
                'conv-1',
                10,
                'invalid_quality'
            );

            expect(nonRetryableError.isRetryable()).toBe(false);
        });

        it('should suggest recovery actions', () => {
            const providerErrorRecovery = new SummarizationError(
                'Message',
                'conv-1',
                10,
                'provider_error'
            ).getSuggestedRecovery();

            expect(providerErrorRecovery).toContain('Retry');

            const invalidResponseRecovery = new SummarizationError(
                'Message',
                'conv-1',
                10,
                'invalid_response'
            ).getSuggestedRecovery();

            expect(invalidResponseRecovery).toContain('prompt');

            const insufficientTokensRecovery = new SummarizationError(
                'Message',
                'conv-1',
                10,
                'insufficient_tokens'
            ).getSuggestedRecovery();

            expect(insufficientTokensRecovery).toContain('Reduce');

            const invalidQualityRecovery = new SummarizationError(
                'Message',
                'conv-1',
                10,
                'invalid_quality'
            ).getSuggestedRecovery();

            expect(invalidQualityRecovery).toContain('Adjust');
        });

        it('should include summary attempt in report if provided', () => {
            const error = new SummarizationError(
                'Test message',
                'conv-1',
                10,
                'invalid_quality',
                'Attempted summary content here'
            );

            const report = error.getDetailedReport();

            expect(report).toContain('Partial Summary');
            expect(report).toContain('Attempted summary');
        });
    });

    describe('ContextWindowConfigError', () => {
        it('should create error with correct properties', () => {
            const error = new ContextWindowConfigError(
                'Invalid config',
                'pruneThreshold',
                -10,
                'Must be positive'
            );

            expect(error.message).toBe('Invalid config');
            expect(error.code).toBe('CONTEXT_WINDOW_CONFIG_ERROR');
            expect(error.configField).toBe('pruneThreshold');
            expect(error.providedValue).toBe(-10);
            expect(error.constraint).toBe('Must be positive');
        });

        it('should generate detailed report', () => {
            const error = new ContextWindowConfigError(
                'Test message',
                'strategy',
                'invalid',
                'Must be prune, summarize, or fail'
            );

            const report = error.getDetailedReport();

            expect(report).toContain('Configuration Error');
            expect(report).toContain('strategy');
            expect(report).toContain('invalid');
        });
    });

    describe('ConversationNotFoundError', () => {
        it('should create error with correct properties', () => {
            const error = new ConversationNotFoundError(
                'Conversation not found',
                'missing-conv'
            );

            expect(error.message).toBe('Conversation not found');
            expect(error.code).toBe('CONVERSATION_NOT_FOUND');
            expect(error.conversationId).toBe('missing-conv');
        });
    });

    describe('isContextWindowError', () => {
        it('should identify context window errors', () => {
            const cwError = new ContextWindowExceededError('msg', 'c1', 5000, 4000, 'prune');
            expect(isContextWindowError(cwError)).toBe(true);

            const summaryError = new SummarizationError('msg', 'c1', 10, 'provider_error');
            expect(isContextWindowError(summaryError)).toBe(true);
        });

        it('should return false for non-context-window errors', () => {
            const genericError = new Error('Generic error');
            expect(isContextWindowError(genericError)).toBe(false);
        });

        it('should return false for null or non-objects', () => {
            expect(isContextWindowError(null)).toBe(false);
            expect(isContextWindowError(undefined)).toBe(false);
            expect(isContextWindowError('string')).toBe(false);
        });
    });

    describe('handleContextWindowError', () => {
        it('should handle summarization errors', () => {
            const error = new SummarizationError('msg', 'c1', 10, 'provider_error');
            const handling = handleContextWindowError(error);

            expect(handling.shouldRetry).toBe(true);
            expect(handling.action).toBe('prune');
        });

        it('should handle context window exceeded errors', () => {
            const error = new ContextWindowExceededError('msg', 'c1', 5000, 4000, 'fail');
            const handling = handleContextWindowError(error);

            expect(handling.shouldRetry).toBe(false);
            expect(handling.shouldFallback).toBe(true);
        });

        it('should handle insufficient context errors', () => {
            const error = new InsufficientContextError('msg', 'c1', 1000, 500, 800);
            const handling = handleContextWindowError(error);

            expect(handling.shouldRetry).toBe(false);
            expect(handling.action).toBe('fail');
        });

        it('should provide recovery guidance', () => {
            const error = new SummarizationError('msg', 'c1', 10, 'provider_error');
            const handling = handleContextWindowError(error);

            expect(handling.message.length).toBeGreaterThan(0);
        });
    });
});
