import { appendFileSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export const LEVEL_VALUES: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4,
};

// ── Internal state ──────────────────────
let _enabled = false;
let _level: LogLevel = 'info';
let _logFile = join(process.cwd(), 'toolpack-sdk.log');

export interface LoggingConfig {
    /** Enable file logging.  Default: false */
    enabled?: boolean;
    /** Log file path.  Default: '<cwd>/toolpack-sdk.log' */
    filePath?: string;
    /** Log level. Default: 'info' */
    level?: LogLevel;
}

function parseLevel(value: string | undefined): LogLevel | undefined {
    if (!value) return undefined;
    const lower = value.toLowerCase();
    if (lower in LEVEL_VALUES) {
        return lower as LogLevel;
    }
    console.warn(`[Toolpack Warning] Invalid log level "${value}". Falling back to "info".`);
    return undefined;
}

/**
 * Initialise the logger.  Call once at SDK start-up.
 *
 * Resolution order (highest wins):
 *   1. Environment variables  (TOOLPACK_SDK_LOG_ENABLED, TOOLPACK_SDK_LOG_LEVEL, TOOLPACK_SDK_LOG_FILE)
 *   2. `config` argument      (from toolpack.config.json → logging section)
 *   3. Defaults               (disabled, info)
 */
export function initLogger(config?: LoggingConfig): void {
    // 1. Config values (only when explicitly provided)
    if (config?.enabled !== undefined) _enabled = config.enabled;
    if (config?.filePath) _logFile = config.filePath;
    
    if (config?.level) {
        _level = parseLevel(config.level) || 'info';
    }

    // 2. Env-var overrides always win
    if (process.env.TOOLPACK_SDK_LOG_ENABLED !== undefined) {
        _enabled = process.env.TOOLPACK_SDK_LOG_ENABLED === 'true';
    }
    if (process.env.TOOLPACK_SDK_LOG_FILE) {
        _logFile = process.env.TOOLPACK_SDK_LOG_FILE;
        _enabled = true; // setting a file path implies enabled
    }
    if (process.env.TOOLPACK_SDK_LOG_LEVEL) {
        _level = parseLevel(process.env.TOOLPACK_SDK_LOG_LEVEL) || _level;
    }
}

// ── Public API (unchanged signatures) ────────────────────────────

/** Get the currently configured log level. */
export function getLogLevel(): LogLevel {
    return _level;
}

/** Check if a given level should be logged based on current config. */
export function shouldLog(level: LogLevel): boolean {
    if (!_enabled) return false;
    return LEVEL_VALUES[level] <= LEVEL_VALUES[_level];
}

// ── Shared write function ────────────────────────────────────────

function writeLog(level: LogLevel, message: string): void {
    if (!shouldLog(level)) return;
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    appendFileSync(_logFile, entry);
}

// ── Level API ────────────────────────────────────────────────────

export function logError(message: string): void { writeLog('error', message); }
export function logWarn(message: string): void { writeLog('warn', message); }
export function logInfo(message: string): void { writeLog('info', message); }
export function logDebug(message: string): void { writeLog('debug', message); }
export function logTrace(message: string): void { writeLog('trace', message); }

/**
 * Log an info message.
 * @deprecated Use `logInfo()`, `logDebug()`, etc. instead. Kept for backward compatibility.
 */
export function log(message: string): void {
    logInfo(message);
}

// ── Formatting Utilities ─────────────────────────────────────────

export function redact(text: string): string {
    return text
        .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
        .replace(/\bsk-proj-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
        .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, '[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/g, 'Bearer [REDACTED]');
}

export function safePreview(value: unknown, maxLen = 200): string {
    try {
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        const redacted = redact(raw);
        if (redacted.length <= maxLen) return redacted;
        return `${redacted.slice(0, maxLen)}…`;
    } catch {
        return '[Unserializable]';
    }
}

export function logMessagePreview(requestId: string, provider: string, messages: any[]): void {
    if (!shouldLog('debug')) return;
    logDebug(`[${provider}][${requestId}] Messages (${messages.length}):`);
    messages.forEach((m, i) => {
        logDebug(`[${provider}][${requestId}]  #${i} role=${m?.role} content=${safePreview(m?.content, 300)}`);
    });
}
