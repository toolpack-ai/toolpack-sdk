import { appendFileSync, mkdirSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export const LEVEL_VALUES: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4,
};

// ── Logger class ─────────────────────────────────────────────────
// One instance per Toolpack — held by ToolRuntimeContext and wired into
// ToolContext.log so each tenant's tool calls write to their own log config.

export class Logger {
    private _enabled = false;
    private _level: LogLevel = 'info';
    private _logFile = join(process.cwd(), 'toolpack-sdk.log');
    private _console = false;

    init(config?: LoggingConfig): void {
        if (config?.enabled !== undefined) this._enabled = config.enabled;
        if (config?.filePath) this._logFile = config.filePath;
        if (config?.level) this._level = parseLevel(config.level) || 'info';

        if (process.env.TOOLPACK_SDK_LOG_ENABLED !== undefined)
            this._enabled = process.env.TOOLPACK_SDK_LOG_ENABLED === 'true';
        if (process.env.TOOLPACK_SDK_LOG_FILE) {
            this._logFile = process.env.TOOLPACK_SDK_LOG_FILE;
            this._enabled = true;
        }
        if (process.env.TOOLPACK_SDK_LOG_LEVEL)
            this._level = parseLevel(process.env.TOOLPACK_SDK_LOG_LEVEL) || this._level;
        if (process.env.TOOLPACK_SDK_LOG_CONSOLE !== undefined)
            this._console = process.env.TOOLPACK_SDK_LOG_CONSOLE === 'true';
        else if (config?.console !== undefined)
            this._console = config.console;

        if (this._enabled) {
            try {
                this._logFile = isAbsolute(this._logFile)
                    ? this._logFile
                    : resolve(process.cwd(), this._logFile);
                mkdirSync(dirname(this._logFile), { recursive: true });
                appendFileSync(
                    this._logFile,
                    `[${new Date().toISOString()}] [INFO] [Logger] initialized level=${this._level} file=${this._logFile}\n`,
                );
            } catch (err) {
                console.warn(`[Toolpack Warning] Failed to initialize log file "${this._logFile}": ${(err as Error).message}`);
                this._enabled = false;
            }
        }
    }

    shouldLog(level: LogLevel): boolean {
        return this._enabled && LEVEL_VALUES[level] <= LEVEL_VALUES[this._level];
    }

    getLevel(): LogLevel { return this._level; }

    write(level: LogLevel, message: string): void {
        if (!this.shouldLog(level)) return;
        const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${redact(message)}`;
        appendFileSync(this._logFile, entry + '\n');
        if (this._console) {
            const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
            fn(entry);
        }
    }

    error(msg: string): void { this.write('error', msg); }
    warn(msg: string):  void { this.write('warn',  msg); }
    info(msg: string):  void { this.write('info',  msg); }
    debug(msg: string): void { this.write('debug', msg); }
    trace(msg: string): void { this.write('trace', msg); }
}

// ── Process-default logger (single-tenant / backward compat) ──────
const _defaultLogger = new Logger();

export interface LoggingConfig {
    /** Enable file logging.  Default: false */
    enabled?: boolean;
    /** Log file path.  Default: '<cwd>/toolpack-sdk.log' */
    filePath?: string;
    /** Log level. Default: 'info' */
    level?: LogLevel;
    /** Mirror log output to console (stderr for error/warn, stdout for others). Default: false */
    console?: boolean;
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
    _defaultLogger.init(config);
}

// ── Public API (unchanged signatures) ────────────────────────────

/** Get the currently configured log level. */
export function getLogLevel(): LogLevel { return _defaultLogger.getLevel(); }

/** Check if a given level should be logged based on current config. */
export function shouldLog(level: LogLevel): boolean { return _defaultLogger.shouldLog(level); }

// ── Level API (delegates to _defaultLogger) ──────────────────────

export function logError(message: string): void { _defaultLogger.error(message); }
export function logWarn(message: string):  void { _defaultLogger.warn(message);  }
export function logInfo(message: string):  void { _defaultLogger.info(message);  }
export function logDebug(message: string): void { _defaultLogger.debug(message); }
export function logTrace(message: string): void { _defaultLogger.trace(message); }

// ── Formatting Utilities ─────────────────────────────────────────

export function redact(text: string): string {
    return text
        .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
        .replace(/\bsk-proj-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
        .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, '[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/g, 'Bearer [REDACTED]')
        // GitHub tokens
        .replace(/\bghs_[A-Za-z0-9]{10,}\b/g, 'ghs_[REDACTED]')
        .replace(/\bghp_[A-Za-z0-9]{10,}\b/g, 'ghp_[REDACTED]')
        .replace(/\bghu_[A-Za-z0-9]{10,}\b/g, 'ghu_[REDACTED]')
        .replace(/\bghr_[A-Za-z0-9]{10,}\b/g, 'ghr_[REDACTED]');
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
