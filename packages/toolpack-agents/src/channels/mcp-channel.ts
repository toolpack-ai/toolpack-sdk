import { BaseChannel } from './base-channel.js';
import type { AgentInput, AgentOutput } from '../agent/types.js';

export interface McpChannelConfig {
    /**
     * Maximum milliseconds to wait for the agent to respond.
     * Default: 120_000 (2 minutes).
     */
    timeout?: number;
}

/**
 * Channel that connects a Toolpack agent to an MCP server as a tool.
 *
 * Unlike other channels (Slack, Webhook) this channel does not own a server or
 * socket. Instead it exposes a `trigger()` method that the MCP tools/call handler
 * calls directly. The agent runs and sends its output back through `send()`, which
 * resolves the Promise that `trigger()` is waiting on.
 *
 * Usage:
 * ```typescript
 * const ch = new McpChannel();
 * const agent = new PrReviewerAgent({ channels: [ch] });
 * await agent.start();
 *
 * await sdk.startMcpServer({
 *   transport: 'stdio',
 *   agents: [ch.asAgentDefinition(agent)],
 * });
 * ```
 *
 * ⚠ One McpChannel handles one concurrent call at a time. If two tools/call
 * requests arrive for the same channel simultaneously, the second call's
 * pendingResolve overwrites the first and the first call's result is lost.
 * Create one McpChannel per agent instance and do not share channels.
 */
export class McpChannel extends BaseChannel {
    readonly isTriggerChannel = false;

    private readonly _timeout: number;
    private _pendingResolve?: (output: AgentOutput) => void;

    constructor(config: McpChannelConfig = {}) {
        super();
        this._timeout = config.timeout ?? 120_000;
    }

    /**
     * No-op — McpChannel is driven by trigger(), not a background listener.
     */
    listen(): void { /* intentional no-op */ }

    /**
     * Resolves the pending trigger() Promise with the agent's output.
     */
    async send(output: AgentOutput): Promise<void> {
        this._pendingResolve?.(output);
        this._pendingResolve = undefined;
    }

    /**
     * Convert raw MCP arguments into AgentInput.
     * If args contains a string 'message' field it is used as the message;
     * otherwise the entire args object is JSON-stringified as the message.
     */
    normalize(incoming: unknown): AgentInput {
        const args = incoming as Record<string, unknown>;
        const message = typeof args['message'] === 'string'
            ? args['message']
            : JSON.stringify(args);
        return {
            message,
            data: args,
            conversationId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        };
    }

    /**
     * Called by the MCP tools/call handler.
     * Triggers the agent and waits for it to respond via send().
     * Rejects if the agent does not respond within the configured timeout.
     */
    async trigger(args: Record<string, unknown>): Promise<string> {
        const input = this.normalize(args);

        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingResolve = undefined;
                reject(new Error(`McpChannel: agent did not respond within ${this._timeout}ms`));
            }, this._timeout);

            this._pendingResolve = (output: AgentOutput) => {
                clearTimeout(timer);
                resolve(output.output);
            };

            // Fire-and-forget — the agent will call send() when done,
            // which resolves the Promise above.
            this.handleMessage(input).catch(err => {
                clearTimeout(timer);
                this._pendingResolve = undefined;
                reject(err instanceof Error ? err : new Error(String(err)));
            });
        });
    }

    /**
     * Produce an McpAgentDefinition suitable for startMcpServer({ agents: [...] }).
     *
     * @param agent  Object with name and description (typically a BaseAgent instance).
     * @param inputSchema  Optional JSON Schema for the tool's input parameters.
     */
    asAgentDefinition(
        agent: { name: string; description: string },
        inputSchema?: Record<string, unknown>,
    ) {
        return {
            name: agent.name,
            description: agent.description,
            ...(inputSchema !== undefined && { inputSchema }),
            invoke: (args: Record<string, unknown>) => this.trigger(args),
        };
    }
}
