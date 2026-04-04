import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { JsonRpcRequest } from "./types.js";
import { logWarn } from '../providers/provider-logger.js';

// ============================================================================
// Configuration
// ============================================================================

export interface McpClientConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;

    /** Default timeout for requests in milliseconds (default: 30000) */
    requestTimeoutMs?: number;

    /** Enable auto-reconnect on unexpected crash (default: false) */
    autoReconnect?: boolean;

    /** Maximum number of reconnection attempts (default: 3) */
    maxReconnectAttempts?: number;

    /** Delay between reconnection attempts in ms (default: 1000) */
    reconnectDelayMs?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class McpTimeoutError extends Error {
    constructor(method: string, timeoutMs: number) {
        super(`MCP request timed out after ${timeoutMs}ms: ${method}`);
        this.name = 'McpTimeoutError';
    }
}

export class McpConnectionError extends Error {
    constructor(message: string, public exitCode?: number | null) {
        super(message);
        this.name = 'McpConnectionError';
    }
}

// ============================================================================
// Client
// ============================================================================

export class McpClient extends EventEmitter {
    private process: ChildProcess | null = null;
    private messageQueue: Map<number | string, {
        resolve: (val: any) => void;
        reject: (err: any) => void;
        timer?: ReturnType<typeof setTimeout>;
    }> = new Map();
    private nextId = 1;
    private buffer = '';

    private _connected = false;
    private _shuttingDown = false;
    private _reconnectAttempts = 0;

    private readonly defaultTimeoutMs: number;
    private readonly autoReconnect: boolean;
    private readonly maxReconnectAttempts: number;
    private readonly reconnectDelayMs: number;

    constructor(private config: McpClientConfig) {
        super();
        this.defaultTimeoutMs = config.requestTimeoutMs ?? 30_000;
        this.autoReconnect = config.autoReconnect ?? false;
        this.maxReconnectAttempts = config.maxReconnectAttempts ?? 3;
        this.reconnectDelayMs = config.reconnectDelayMs ?? 1000;
    }

    /** Whether the client is currently connected */
    get connected(): boolean {
        return this._connected && this.process !== null;
    }

    // ======================================================================
    // Connection
    // ======================================================================

    async connect(): Promise<void> {
        if (this._shuttingDown) {
            throw new McpConnectionError('Client is shutting down');
        }

        return new Promise((resolve, reject) => {
            try {
                this.buffer = '';
                this.process = spawn(this.config.command, this.config.args || [], {
                    env: { ...process.env, ...this.config.env },
                    stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
                });

                if (!this.process.stdout || !this.process.stdin) {
                    throw new McpConnectionError('Failed to spawn MCP server: stdout/stdin unavailable');
                }

                this.process.stdout.on('data', (data: Buffer) => {
                    this.handleData(data);
                });

                // Route child stderr through logger instead of inheriting
                // (inherited stderr corrupts Ink TUI rendering)
                if (this.process.stderr) {
                    this.process.stderr.on('data', (data: Buffer) => {
                        logWarn(`[MCP server stderr] ${data.toString().trim()}`);
                    });
                }

                this.process.on('error', (err) => {
                    this._connected = false;
                    this.emit('error', err);
                });

                this.process.on('exit', (code) => {
                    const wasConnected = this._connected;
                    this._connected = false;
                    this.process = null;

                    // Reject all pending requests
                    this.rejectAllPending(
                        new McpConnectionError(`MCP server exited with code ${code}`, code)
                    );

                    this.emit('close', code);

                    // Auto-reconnect on unexpected crash
                    if (wasConnected && !this._shuttingDown && this.autoReconnect) {
                        this.attemptReconnect();
                    }
                });

                this._connected = true;
                this._reconnectAttempts = 0;

                // Give it a moment to start
                setTimeout(resolve, 500);
            } catch (error) {
                reject(error);
            }
        });
    }

    // ======================================================================
    // Reconnection
    // ======================================================================

    private async attemptReconnect(): Promise<void> {
        if (this._reconnectAttempts >= this.maxReconnectAttempts) {
            this.emit('reconnect_failed', this._reconnectAttempts);
            return;
        }

        this._reconnectAttempts++;
        const attempt = this._reconnectAttempts;

        this.emit('reconnecting', { attempt, max: this.maxReconnectAttempts });

        await new Promise(r => setTimeout(r, this.reconnectDelayMs * attempt));

        if (this._shuttingDown) return;

        try {
            await this.connect();
            this.emit('reconnected', { attempt });
        } catch (err) {
            this.emit('reconnect_error', { attempt, error: err });
            // Will retry on next exit event if still within limits
        }
    }

    // ======================================================================
    // Data Handling
    // ======================================================================

    private handleData(data: Buffer) {
        this.buffer += data.toString();

        // Process messages delimited by newlines (NDJSON-like for MCP)
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);

            if (line) {
                try {
                    const message = JSON.parse(line);
                    this.handleMessage(message);
                } catch (e) {
                    // Ignore unparseable lines (e.g. server startup logs)
                }
            }
        }
    }

    private handleMessage(message: any) {
        if (message.id && (message.result !== undefined || message.error)) {
            // It's a response
            const handler = this.messageQueue.get(message.id);
            if (handler) {
                // Clear the timeout timer
                if (handler.timer) clearTimeout(handler.timer);

                if (message.error) {
                    handler.reject(new Error(message.error.message));
                } else {
                    handler.resolve(message.result);
                }
                this.messageQueue.delete(message.id);
            }
        } else if (message.method) {
            // It's a notification/event
            this.emit('notification', message);
            this.emit(message.method, message.params);
        }
    }

    // ======================================================================
    // Request API
    // ======================================================================

    async callTool(name: string, args: any = {}, timeoutMs?: number): Promise<any> {
        return this.request('tools/call', { name, arguments: args }, timeoutMs);
    }

    async readResource(uri: string, timeoutMs?: number): Promise<any> {
        return this.request('resources/read', { uri }, timeoutMs);
    }

    async request(method: string, params?: any, timeoutMs?: number): Promise<any> {
        if (!this.process || !this.process.stdin) {
            throw new McpConnectionError('Client not connected');
        }

        const id = this.nextId++;
        const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };

        return new Promise((resolve, reject) => {
            // Set up timeout
            let timer: ReturnType<typeof setTimeout> | undefined;
            if (effectiveTimeout > 0) {
                timer = setTimeout(() => {
                    const handler = this.messageQueue.get(id);
                    if (handler) {
                        this.messageQueue.delete(id);
                        handler.reject(new McpTimeoutError(method, effectiveTimeout));
                    }
                }, effectiveTimeout);
            }

            this.messageQueue.set(id, { resolve, reject, timer });

            try {
                this.process!.stdin!.write(JSON.stringify(request) + '\n');
            } catch (err) {
                if (timer) clearTimeout(timer);
                this.messageQueue.delete(id);
                reject(err);
            }
        });
    }

    // ======================================================================
    // Shutdown
    // ======================================================================

    /**
     * Graceful disconnect: rejects pending requests, sends SIGTERM,
     * waits briefly, then SIGKILL if still alive.
     */
    async disconnect(gracefulTimeoutMs = 3000): Promise<void> {
        this._shuttingDown = true;

        // Reject all pending requests immediately
        this.rejectAllPending(new McpConnectionError('Client disconnecting'));

        if (!this.process) {
            this._shuttingDown = false;
            return;
        }

        const proc = this.process;

        return new Promise<void>((resolve) => {
            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                this.process = null;
                this._connected = false;
                this._shuttingDown = false;
                resolve();
            };

            // Listen for exit
            proc.once('exit', done);

            // Send SIGTERM first
            proc.kill('SIGTERM');

            // Force kill after timeout
            setTimeout(() => {
                if (!resolved) {
                    try {
                        proc.kill('SIGKILL');
                    } catch {
                        // Process may already be dead
                    }
                    done();
                }
            }, gracefulTimeoutMs);
        });
    }

    /**
     * Hard kill (legacy compat — prefer disconnect() for graceful shutdown)
     */
    kill(): void {
        this._shuttingDown = true;
        this.rejectAllPending(new McpConnectionError('Client killed'));
        if (this.process) {
            this.process.kill('SIGKILL');
            this.process = null;
        }
        this._connected = false;
        this._shuttingDown = false;
    }

    // ======================================================================
    // Internal Helpers
    // ======================================================================

    private rejectAllPending(error: Error): void {
        for (const [_id, handler] of this.messageQueue) {
            if (handler.timer) clearTimeout(handler.timer);
            handler.reject(error);
        }
        this.messageQueue.clear();
    }
}
