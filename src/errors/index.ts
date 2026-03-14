export class SDKError extends Error {
    constructor(message: string, public code: string, public statusCode?: number, public cause?: any) {
        super(message);
        this.name = 'SDKError';
    }
}

export class AuthenticationError extends SDKError {
    constructor(message: string, cause?: any) {
        super(message, 'AUTHENTICATION_ERROR', 401, cause);
        this.name = 'AuthenticationError';
    }
}

export class RateLimitError extends SDKError {
    constructor(message: string, public retryAfter?: number, cause?: any) {
        super(message, 'RATE_LIMIT_ERROR', 429, cause);
        this.name = 'RateLimitError';
    }
}

export class InvalidRequestError extends SDKError {
    constructor(message: string, cause?: any) {
        super(message, 'INVALID_REQUEST_ERROR', 400, cause);
        this.name = 'InvalidRequestError';
    }
}

export class ProviderError extends SDKError {
    constructor(message: string, code: string = 'PROVIDER_ERROR', statusCode: number = 500, cause?: any) {
        super(message, code, statusCode, cause);
        this.name = 'ProviderError';
    }
}

export class ConnectionError extends SDKError {
    constructor(message: string, cause?: any) {
        super(message, 'CONNECTION_ERROR', 503, cause);
        this.name = 'ConnectionError';
    }
}

export class PageError extends SDKError {
    constructor(message: string, public pageUrl?: string, cause?: any) {
        super(message, 'PAGE_ERROR', 502, cause);
        this.name = 'PageError';
    }
}

export class TimeoutError extends SDKError {
    constructor(message: string, public phase?: string, cause?: any) {
        super(message, 'TIMEOUT_ERROR', 504, cause);
        this.name = 'TimeoutError';
    }
}
