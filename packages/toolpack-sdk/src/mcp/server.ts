import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext, ToolDefinition } from '../tools/types.js';
import type { ToolpackMcpServerConfig, McpServerHandle } from './server-types.js';
import { logInfo } from '../providers/provider-logger.js';
import { buildVerifier, applyBearerAuth } from './server-auth.js';
import { getToolSearchSchema, isToolSearchTool, TOOL_SEARCH_NAME } from '../tools/search/index.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start an MCP server exposing Toolpack's built-in tools.
 *
 * Uses the low-level Server class (not McpServer) because Toolpack tools use
 * plain JSON Schema and McpServer.tool() only accepts Zod schemas.
 */
export async function startMcpServer(
    registry: ToolRegistry,
    config: ToolpackMcpServerConfig,
    searchFn?: (args: Record<string, unknown>) => string,
): Promise<McpServerHandle> {

    // 1. Create the low-level MCP Server with tools capability declared
    const server = new Server(
        {
            name: config.serverName ?? 'Toolpack SDK',
            version: config.serverVersion ?? '2.0.0',
        },
        {
            capabilities: { tools: {} },
        },
    );

    // 2. Handle tools/list — resolve fresh on every request so tools added
    //    via loadToolProject() after startMcpServer() are always included.
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        if (config.searchMode) {
            // Search mode: expose tool.search + always-loaded tools only.
            // All other tools are deferred — clients call tool.search to discover them.
            const alwaysLoaded = resolveAlwaysLoadedTools(registry, config);
            const searchToolSchema = getToolSearchSchema();
            const alwaysLoadedEntries = alwaysLoaded.map(tool => {
                const annotations = deriveAnnotations(tool);
                return {
                    name: tool.name,
                    description: tool.description ?? '',
                    inputSchema: (tool.parameters ?? { type: 'object', properties: {} }) as unknown as Record<string, unknown>,
                    ...(annotations !== undefined && { annotations }),
                };
            });
            // Agents are always listed even in search mode — they are not in the
            // ToolRegistry so tool.search cannot discover them. Omitting them here
            // would make them completely invisible and uncallable.
            return {
                tools: [
                    {
                        name: searchToolSchema.name,
                        description: searchToolSchema.description ?? '',
                        inputSchema: searchToolSchema.parameters as unknown as Record<string, unknown>,
                        annotations: { readOnlyHint: true },
                    },
                    ...alwaysLoadedEntries,
                    ...buildAgentEntries(config),
                ],
            };
        }

        const tools = resolveTools(registry, config.expose);
        const toolEntries = tools.map(tool => {
            const annotations = deriveAnnotations(tool);
            return {
                name: tool.name,
                description: tool.description ?? '',
                inputSchema: (tool.parameters ?? { type: 'object', properties: {} }) as unknown as Record<string, unknown>,
                // Only include annotations when there is actual signal — omitting lets
                // MCP spec defaults apply (destructiveHint: true, openWorldHint: true),
                // which are the correct conservative defaults for uncategorised tools.
                ...(annotations !== undefined && { annotations }),
            };
        });

        return { tools: [...toolEntries, ...buildAgentEntries(config)] };
    });

    // 3. Handle tools/call — intercept tool.search in search mode, then normal lookup
    server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
        const { name, arguments: args } = request.params;

        // Intercept tool.search when search mode is enabled.
        if (config.searchMode && isToolSearchTool(name)) {
            if (!searchFn) {
                return toMcpResult('tool.search is not available: searchFn was not provided to startMcpServer.', true);
            }
            try {
                const result = searchFn(args ?? {});
                return toMcpResult(result);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return toMcpResult(`tool.search error: ${message}`, true);
            }
        }

        // Intercept agent.* calls before the normal tool lookup.
        if (name.startsWith('agent.')) {
            const agentName = name.slice('agent.'.length);
            const agentDef = (config.agents ?? []).find(a => a.name === agentName);
            if (!agentDef) {
                return toMcpResult(`Agent not found: ${agentName}`, true);
            }
            try {
                const output = await agentDef.invoke(args ?? {});
                return toMcpResult(output);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return toMcpResult(`Agent error (${agentName}): ${message}`, true);
            }
        }

        const tool = resolveToolByName(registry, name, config.expose);

        if (!tool) {
            return toMcpResult(`Tool not found: ${name}`, true);
        }

        try {
            const ctx: ToolContext = {
                workspaceRoot: process.cwd(),
                config: registry.getConfig().additionalConfigurations ?? {},
                log: (msg) => logInfo(`[MCP Tool] ${msg}`),
            };
            const result = await tool.execute(args ?? {}, ctx);
            return toMcpResult(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return toMcpResult(`Error executing ${name}: ${message}`, true);
        }
    });

    // 4. Connect the appropriate transport
    if (config.transport === 'stdio') {
        const transport = new StdioServerTransport();
        await server.connect(transport);

        return {
            get toolCount() { return resolveTools(registry, config.expose).length; },
            port: 0,
            stop: async () => { await server.close(); },
        };
    }

    if (config.transport === 'http') {
        const port = config.port ?? 3000;

        // Warn when running without auth — open HTTP server is unsafe beyond localhost.
        if (!config.auth) {
            logInfo(
                '[MCP Server] Warning: HTTP transport started without authentication. ' +
                'Safe for localhost only. Set `auth` in startMcpServer() before ' +
                'exposing this server to a network.',
            );
        }

        // StreamableHTTPServerTransport is middleware — it does NOT bind to a port.
        // We create a Node.js http.Server and route all requests through it.
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
        });

        // Build the verifier once — JwtVerifier caches the JWKS key set internally,
        // so creating it per-request would defeat the caching and cause unnecessary
        // network fetches.
        const verifier = config.auth ? buildVerifier(config.auth) : null;

        const httpServer = createServer(async (req, res) => {
            // ── OAuth Protected Resource Metadata (RFC 9728) ──────────────────
            // Allows MCP clients to discover which OAuth server issues tokens for
            // this server. Only mounted for jwt mode — static/custom auth has no
            // external OAuth server to advertise.
            if (
                config.auth?.mode === 'jwt' &&
                config.serverUrl &&
                req.url === '/.well-known/oauth-protected-resource'
            ) {
                const metadata: Record<string, unknown> = { resource: config.serverUrl };
                if (config.auth.issuer) {
                    metadata['authorization_servers'] = [config.auth.issuer];
                }
                res.writeHead(200, { 'Content-Type': 'application/json' })
                   .end(JSON.stringify(metadata));
                return;
            }

            // ── Bearer auth ───────────────────────────────────────────────────
            // When auth is configured, every request must carry a valid Bearer
            // token. applyBearerAuth writes 401/403 and returns false on failure.
            if (verifier) {
                const ok = await applyBearerAuth(
                    req as IncomingMessage & { auth?: AuthInfo },
                    res,
                    config.auth!,
                    verifier,
                ).catch(err => {
                    // Unexpected error in the verifier itself (e.g. JWKS fetch crash).
                    logInfo(`[MCP Server] Auth error: ${err instanceof Error ? err.message : String(err)}`);
                    if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
                    return false;
                });
                if (!ok) return;
            }

            // ── MCP transport ─────────────────────────────────────────────────
            transport.handleRequest(req, res).catch(err => {
                logInfo(`[MCP Server] HTTP request handler error: ${err instanceof Error ? err.message : String(err)}`);
                if (!res.headersSent) {
                    res.writeHead(500).end('Internal Server Error');
                }
            });
        });

        await server.connect(transport);

        try {
            await new Promise<void>((resolve, reject) => {
                const onError = (err: NodeJS.ErrnoException) => {
                    reject(err.code === 'EADDRINUSE'
                        ? new Error(`MCP HTTP server failed to start: port ${port} is already in use.`)
                        : err,
                    );
                };
                httpServer.once('error', onError);
                httpServer.listen(port, () => {
                    httpServer.off('error', onError);
                    resolve();
                });
            });
        } catch (listenErr) {
            // httpServer failed to start — close the already-connected server
            // and transport so they don't leak.
            await server.close().catch(() => { /* ignore close errors during cleanup */ });
            throw listenErr;
        }

        const boundPort = (httpServer.address() as { port: number }).port;

        return {
            get toolCount() { return resolveTools(registry, config.expose).length; },
            port: boundPort,
            stop: async () => {
                try {
                    await server.close();
                } finally {
                    await new Promise<void>((resolve, reject) => {
                        httpServer.close(err => (err ? reject(err) : resolve()));
                    });
                }
            },
        };
    }

    throw new Error(`Unknown MCP transport: "${config.transport}". Use 'stdio' or 'http'.`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveTools(registry: ToolRegistry, expose?: ToolpackMcpServerConfig['expose']) {
    if (!expose) return registry.getEnabled();
    // Treat empty arrays as "not specified" — expose all rather than zero tools silently
    if (expose.categories?.length) return registry.getByCategories(expose.categories);
    if (expose.tools?.length) return registry.getByNames(expose.tools);
    return registry.getEnabled();
}

// O(1) variant used by tools/call — avoids iterating the full list just to find one tool.
// Must stay consistent with resolveTools: a tool that doesn't appear in tools/list
// must not be callable via tools/call.
function resolveToolByName(
    registry: ToolRegistry,
    name: string,
    expose?: ToolpackMcpServerConfig['expose'],
): ToolDefinition | undefined {
    const tool = registry.get(name);
    if (!tool) return undefined;

    if (expose?.categories?.length) return new Set(expose.categories).has(tool.category) ? tool : undefined;
    if (expose?.tools?.length) return expose.tools.includes(name) ? tool : undefined;

    // No active MCP-level filter (expose is undefined or has empty arrays) —
    // fall back to the registry's own enabled filter, matching resolveTools behaviour.
    return isEnabledInRegistry(registry, tool, name) ? tool : undefined;
}

// Returns true when the tool passes the registry's enabledTools / enabledToolCategories
// config. Fast path (default config): both arrays are empty → all registered tools enabled.
function isEnabledInRegistry(registry: ToolRegistry, tool: ToolDefinition, name: string): boolean {
    const { enabledTools, enabledToolCategories } = registry.getConfig();
    if (enabledTools.length === 0 && enabledToolCategories.length === 0) return true;
    return enabledTools.includes(name) || enabledToolCategories.includes(tool.category);
}

/** Build the tools/list entries for all configured agents. */
function buildAgentEntries(config: ToolpackMcpServerConfig) {
    return (config.agents ?? []).map(agent => ({
        name: `agent.${agent.name}`,
        description: agent.description,
        inputSchema: (agent.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
}

/**
 * Resolve the always-loaded tools for search mode.
 * These appear in tools/list alongside tool.search — clients can call them directly
 * without searching first. Respects the expose filter if set.
 */
function resolveAlwaysLoadedTools(
    registry: ToolRegistry,
    config: ToolpackMcpServerConfig,
): ToolDefinition[] {
    const searchConfig = registry.getConfig().toolSearch;
    if (!searchConfig) return [];

    const byName = registry.getByNames(searchConfig.alwaysLoadedTools);
    const byCategory = registry.getByCategories(searchConfig.alwaysLoadedCategories);

    // Deduplicate and apply expose filter so always-loaded tools are also
    // restricted to what's actually callable.
    const seen = new Set<string>([TOOL_SEARCH_NAME]); // exclude tool.search itself
    const candidates = [...byName, ...byCategory].filter(t => {
        if (seen.has(t.name)) return false;
        seen.add(t.name);
        return true;
    });

    // Intersect with expose filter when active
    if (config.expose?.categories?.length) {
        const cats = new Set(config.expose.categories);
        return candidates.filter(t => cats.has(t.category));
    }
    if (config.expose?.tools?.length) {
        const names = new Set(config.expose.tools);
        return candidates.filter(t => names.has(t.name));
    }
    return candidates;
}

/**
 * Derive MCP tool annotations from a ToolDefinition.
 *
 * Priority:
 *   1. Explicit tool.annotations — used as-is.
 *   2. tool.confirmation present — { destructiveHint: true } (tool modifies state).
 *   3. Neither — undefined (omit annotations; MCP spec defaults apply).
 *
 * MCP spec defaults when annotations are absent:
 *   readOnlyHint: false, destructiveHint: true, openWorldHint: true
 *
 * These conservative defaults are correct for tools we have no signal about
 * (e.g. slack.post, gh.create_pr, create-dir — not read-only but no confirmation set).
 * Returning readOnlyHint: true for those tools would be a semantic lie.
 */
function deriveAnnotations(tool: ToolDefinition): Record<string, unknown> | undefined {
    if (tool.annotations) return tool.annotations as Record<string, unknown>;
    if (tool.confirmation) return { destructiveHint: true };
    return undefined;
}

function toMcpResult(result: unknown, isError = false) {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text' as const, text }], isError };
}
