import { SDKError } from './index.js';

/**
 * Thrown when a conversation exceeds the configured context window limit
 * and cannot be recovered through pruning or summarization
 */
export class ContextWindowExceededError extends SDKError {
  constructor(
    message: string,
    public conversationId: string,
    public currentTokens: number,
    public contextWindowLimit: number,
    public strategy: 'prune' | 'summarize' | 'fail',
    cause?: any
  ) {
    super(message, 'CONTEXT_WINDOW_EXCEEDED', 400, cause);
    this.name = 'ContextWindowExceededError';
  }

  /**
   * Get the number of tokens over the limit
   */
  getOverageTokens(): number {
    return Math.max(0, this.currentTokens - this.contextWindowLimit);
  }

  /**
   * Get the percentage of the context window being used
   */
  getUsagePercentage(): number {
    return Math.round((this.currentTokens / this.contextWindowLimit) * 100);
  }

  /**
   * Get a detailed error report
   */
  getDetailedReport(): string {
    return `
Context Window Exceeded
=======================
Conversation ID: ${this.conversationId}
Current Tokens: ${this.currentTokens}
Context Window Limit: ${this.contextWindowLimit}
Overage: ${this.getOverageTokens()} tokens
Usage: ${this.getUsagePercentage()}%
Strategy: ${this.strategy}

Message: ${this.message}
    `.trim();
  }
}

/**
 * Thrown when there is insufficient context remaining to process a request
 * after pruning or summarization, even though tokens are within limits
 */
export class InsufficientContextError extends SDKError {
  constructor(
    message: string,
    public conversationId: string,
    public requiredTokens: number,
    public availableTokens: number,
    public minimumRequiredTokens: number,
    cause?: any
  ) {
    super(message, 'INSUFFICIENT_CONTEXT', 400, cause);
    this.name = 'InsufficientContextError';
  }

  /**
   * Get the token deficit
   */
  getDeficit(): number {
    return Math.max(0, this.requiredTokens - this.availableTokens);
  }

  /**
   * Whether the deficit could be recovered by adjusting the strategy
   */
  isRecoverable(): boolean {
    return this.availableTokens >= this.minimumRequiredTokens * 0.5;
  }

  /**
   * Get a detailed error report
   */
  getDetailedReport(): string {
    return `
Insufficient Context
====================
Conversation ID: ${this.conversationId}
Required Tokens: ${this.requiredTokens}
Available Tokens: ${this.availableTokens}
Deficit: ${this.getDeficit()} tokens
Minimum Required: ${this.minimumRequiredTokens}
Recoverable: ${this.isRecoverable() ? 'Yes' : 'No'}

Message: ${this.message}
    `.trim();
  }
}

/**
 * Thrown when summarization fails or produces inadequate results
 */
export class SummarizationError extends SDKError {
  constructor(
    message: string,
    public conversationId: string,
    public messageCount: number,
    public failureReason: 'provider_error' | 'invalid_response' | 'insufficient_tokens' | 'invalid_quality' | 'unknown',
    public summaryAttempt?: string,
    cause?: any
  ) {
    super(message, 'SUMMARIZATION_ERROR', 500, cause);
    this.name = 'SummarizationError';
  }

  /**
   * Whether the error is retryable
   */
  isRetryable(): boolean {
    return this.failureReason === 'provider_error' || this.failureReason === 'insufficient_tokens';
  }

  /**
   * Get suggested recovery action
   */
  getSuggestedRecovery(): string {
    switch (this.failureReason) {
      case 'provider_error':
        return 'Retry the summarization request or switch to a different summarizer model';
      case 'invalid_response':
        return 'Review the summarizer prompt or use a different model';
      case 'insufficient_tokens':
        return 'Reduce the number of messages to summarize or increase the summary token budget';
      case 'invalid_quality':
        return 'Adjust summarization parameters or use a more capable model';
      default:
        return 'Manual intervention required';
    }
  }

  /**
   * Get a detailed error report
   */
  getDetailedReport(): string {
    const report = `
Summarization Error
===================
Conversation ID: ${this.conversationId}
Messages Attempted: ${this.messageCount}
Failure Reason: ${this.failureReason}
Retryable: ${this.isRetryable() ? 'Yes' : 'No'}
Recovery Action: ${this.getSuggestedRecovery()}

Message: ${this.message}`;

    if (this.summaryAttempt) {
      return report + `

Partial Summary:
${this.summaryAttempt.substring(0, 500)}${this.summaryAttempt.length > 500 ? '...' : ''}`;
    }

    return report.trim();
  }
}

/**
 * Thrown when context window configuration is invalid
 */
export class ContextWindowConfigError extends SDKError {
  constructor(
    message: string,
    public configField: string,
    public providedValue: any,
    public constraint: string,
    cause?: any
  ) {
    super(message, 'CONTEXT_WINDOW_CONFIG_ERROR', 400, cause);
    this.name = 'ContextWindowConfigError';
  }

  /**
   * Get a detailed error report
   */
  getDetailedReport(): string {
    return `
Context Window Configuration Error
===================================
Field: ${this.configField}
Provided Value: ${JSON.stringify(this.providedValue)}
Constraint: ${this.constraint}

Message: ${this.message}
    `.trim();
  }
}

/**
 * Thrown when a state operation is performed on a non-existent conversation
 */
export class ConversationNotFoundError extends SDKError {
  constructor(message: string, public conversationId: string, cause?: any) {
    super(message, 'CONVERSATION_NOT_FOUND', 404, cause);
    this.name = 'ConversationNotFoundError';
  }
}

/**
 * Utility function to check if an error is context window related
 */
export function isContextWindowError(error: any): error is SDKError & { code: string } {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const contextWindowErrorCodes = [
    'CONTEXT_WINDOW_EXCEEDED',
    'INSUFFICIENT_CONTEXT',
    'SUMMARIZATION_ERROR',
    'CONTEXT_WINDOW_CONFIG_ERROR',
    'CONVERSATION_NOT_FOUND',
  ];

  return contextWindowErrorCodes.includes(error.code);
}

/**
 * Utility function to handle context window errors
 */
export function handleContextWindowError(
  error: SDKError,
  _conversationId?: string
): {
  shouldRetry: boolean;
  shouldFallback: boolean;
  action: 'prune' | 'summarize' | 'fail' | 'none';
  message: string;
} {
  if (error instanceof SummarizationError) {
    return {
      shouldRetry: error.isRetryable(),
      shouldFallback: true,
      action: error.isRetryable() ? 'prune' : 'fail',
      message: error.getSuggestedRecovery(),
    };
  }

  if (error instanceof ContextWindowExceededError) {
    return {
      shouldRetry: false,
      shouldFallback: true,
      action: error.strategy === 'fail' ? 'prune' : 'none',
      message: `Context window exceeded. Strategy: ${error.strategy}`,
    };
  }

  if (error instanceof InsufficientContextError) {
    return {
      shouldRetry: false,
      shouldFallback: true,
      action: 'fail',
      message: 'Insufficient context after recovery attempts',
    };
  }

  return {
    shouldRetry: false,
    shouldFallback: false,
    action: 'none',
    message: 'Unknown context window error',
  };
}
