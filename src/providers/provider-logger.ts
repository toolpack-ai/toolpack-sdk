import { appendFileSync } from 'fs';
import { join } from 'path';

// ── Internal state (opt-in, off by default) ──────────────────────
let _enabled = false;
let _logFile = join(process.cwd(), 'toolpack-sdk.log');
let _verbose = false;

export interface LoggingConfig {
    /** Enable file logging.  Default: false */
    enabled?: boolean;
    /** Log file path.  Default: '<cwd>/toolpack-sdk.log' */
    filePath?: string;
    /** Enable verbose logging (message previews).  Default: false */
    verbose?: boolean;
}

/**
 * Initialise the logger.  Call once at SDK start-up.
 *
 * Resolution order (highest wins):
 *   1. Environment variables  (TOOLPACK_SDK_LOG_FILE / TOOLPACK_SDK_LOG_VERBOSE)
 *   2. `config` argument      (from toolpack.config.json → logging section)
 *   3. Defaults               (disabled)
 */
export function initLogger(config?: LoggingConfig): void {
    // Config values (only when explicitly provided)
    if (config?.enabled !== undefined) _enabled = config.enabled;
    if (config?.filePath) _logFile = config.filePath;
    if (config?.verbose !== undefined) _verbose = config.verbose;

    // Env-var overrides always win
    if (process.env.TOOLPACK_SDK_LOG_FILE) {
        _logFile = process.env.TOOLPACK_SDK_LOG_FILE;
        _enabled = true;                       // setting a file path implies enabled
    }
    if (process.env.TOOLPACK_SDK_LOG_VERBOSE === 'true') {
        _verbose = true;
        _enabled = true;                       // verbose implies enabled
    }
}

// ── Public API (unchanged signatures) ────────────────────────────

/** Whether verbose logging is active. */
export function isVerbose(): boolean {
    return _verbose;
}

/**
 * @deprecated Use `isVerbose()` instead. This is kept for backward compatibility
 * but will always return the current dynamic value.
 */
export const LOG_VERBOSE = false; // Static false; adapters should migrate to isVerbose()

export function log(message: string): void {
    if (!_enabled) return;
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}\n`;
    appendFileSync(_logFile, entry);
}

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
    if (!_verbose) return;
    log(`[${provider}][${requestId}] Messages (${messages.length}):`);
    messages.forEach((m, i) => {
        log(`[${provider}][${requestId}]  #${i} role=${m?.role} content=${safePreview(m?.content, 300)}`);
    });
}
