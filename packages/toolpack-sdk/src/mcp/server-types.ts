import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export type McpTransport = 'stdio' | 'http';

// Re-export AuthInfo so users implementing custom verifiers don't need to
// import from the SDK's internal path directly.
export type { AuthInfo };

// ─── Auth config ──────────────────────────────────────────────────────────────

export interface McpServerExposeConfig {
    /** Expose only tools in these categories. Mutually exclusive with `tools`. */
    categories?: string[];
    /** Expose only these exact tool names. Mutually exclusive with `categories`. */
    tools?: string[];
}

export interface McpStaticAuthConfig {
    mode: 'static';
    /**
     * One or more pre-shared bearer tokens that grant access.
     * Generate with: crypto.randomBytes(32).toString('hex')
     * All tokens in the array are valid — useful for token rotation.
     */
    tokens: string[];
}

export interface McpJwtAuthConfig {
    mode: 'jwt';
    /**
     * JWKS endpoint URL for JWT signature verification.
     * @example 'https://your-tenant.auth0.com/.well-known/jwks.json'
     * @example 'https://your-project.supabase.co/auth/v1/jwks'
     */
    jwksUrl: string;
    /**
     * Expected `aud` claim in the JWT.
     * Required for most OIDC providers — omitting may accept tokens intended for other services.
     */
    audience?: string;
    /**
     * Expected `iss` claim in the JWT. Recommended.
     * Also used to populate the `authorization_servers` field in
     * /.well-known/oauth-protected-resource when serverUrl is set.
     */
    issuer?: string;
    /** JWT must have all of these scopes. Checked after signature verification. */
    requiredScopes?: string[];
}

export interface McpCustomAuthConfig {
    mode: 'custom';
    /**
     * Your own token verification logic.
     * Throw any error to reject the token — the caller receives a 401.
     * Return a valid AuthInfo on success.
     *
     * @example
     * ```typescript
     * verifyAccessToken: async (token) => {
     *   const user = await db.findByToken(token);
     *   if (!user) throw new Error('Invalid token');
     *   return { token, clientId: user.id, scopes: user.scopes };
     * }
     * ```
     */
    verifyAccessToken(token: string): Promise<AuthInfo>;
    /** Token must have all of these scopes. Checked after verifyAccessToken resolves. */
    requiredScopes?: string[];
}

export type McpAuthConfig = McpStaticAuthConfig | McpJwtAuthConfig | McpCustomAuthConfig;

// ─── Agent definition ─────────────────────────────────────────────────────────

/**
 * Minimal contract for exposing an agent as an MCP tool.
 * Satisfied by McpChannel.asAgentDefinition() from toolpack-agents,
 * or by any plain object with these four fields.
 */
export interface McpAgentDefinition {
    /** Exposed as "agent.<name>" in tools/list. Must be unique across all agents. */
    name: string;
    /** Shown to the MCP client as the tool description. */
    description: string;
    /** JSON Schema for the arguments the agent accepts. Defaults to empty object schema. */
    inputSchema?: Record<string, unknown>;
    /**
     * Called when tools/call arrives for this agent.
     * Must return the agent's output as a string.
     * Throw to signal an error — the MCP client receives isError: true.
     */
    invoke(args: Record<string, unknown>): Promise<string>;
}

// ─── Server config ────────────────────────────────────────────────────────────

export interface ToolpackMcpServerConfig {
    /** Transport type. 'stdio' for Claude Desktop / Cursor. 'http' for remote use. */
    transport: McpTransport;
    /** Port for HTTP transport. Default: 3000. Only used when transport is 'http'. */
    port?: number;
    /** Filter which tools to expose. Exposes all enabled tools when omitted. */
    expose?: McpServerExposeConfig;
    /** Server name shown to MCP clients. Default: 'Toolpack SDK'. */
    serverName?: string;
    /** Server version shown to MCP clients. Default: '2.0.0'. */
    serverVersion?: string;

    /**
     * Authentication for the HTTP transport. Ignored when transport is 'stdio'.
     *
     * When omitted, the HTTP server accepts all requests — safe for localhost only.
     * When set, every request must carry a valid Bearer token; missing or invalid
     * tokens are rejected with 401. Scope violations are rejected with 403.
     *
     * @example Static tokens (dev / self-hosted)
     * ```typescript
     * auth: { mode: 'static', tokens: [process.env.MCP_TOKEN!] }
     * ```
     *
     * @example JWT with Auth0 / Supabase / Clerk
     * ```typescript
     * auth: {
     *   mode: 'jwt',
     *   jwksUrl: 'https://your-tenant.auth0.com/.well-known/jwks.json',
     *   audience: 'https://your-mcp-server.example.com',
     *   issuer:   'https://your-tenant.auth0.com/',
     * }
     * ```
     *
     * @example Custom verification
     * ```typescript
     * auth: {
     *   mode: 'custom',
     *   verifyAccessToken: async (token) => {
     *     const user = await db.findByToken(token);
     *     if (!user) throw new Error('invalid');
     *     return { token, clientId: user.id, scopes: user.scopes };
     *   }
     * }
     * ```
     */
    auth?: McpAuthConfig;

    /**
     * Agents to expose as MCP tools alongside regular tools.
     * Each agent appears in tools/list as "agent.<name>".
     *
     * Agents run to completion before returning — synchronous from the MCP
     * client's perspective. For long-running agents, ensure the MCP client's
     * timeout is set appropriately.
     *
     * The easiest way to produce an entry is via McpChannel.asAgentDefinition()
     * from toolpack-agents. A plain object with { name, description, invoke }
     * also works — no import from toolpack-agents required.
     *
     * @example using McpChannel (toolpack-agents)
     * ```typescript
     * const ch = new McpChannel();
     * const agent = new PrReviewerAgent({ channels: [ch] });
     * await agent.start();
     * await sdk.startMcpServer({
     *   transport: 'stdio',
     *   agents: [ch.asAgentDefinition(agent)],
     * });
     * ```
     *
     * @example plain object (no extra dependency)
     * ```typescript
     * await sdk.startMcpServer({
     *   transport: 'stdio',
     *   agents: [{
     *     name: 'pr_reviewer',
     *     description: 'Reviews a pull request end-to-end.',
     *     inputSchema: { type: 'object', properties: { pr_url: { type: 'string' } }, required: ['pr_url'] },
     *     invoke: async (args) => {
     *       const result = await prReviewer.invokeAgent({ data: args });
     *       return result.output;
     *     },
     *   }],
     * });
     * ```
     */
    agents?: McpAgentDefinition[];

    /**
     * Enable tool search mode.
     *
     * When true, tools/list returns only `tool.search` plus any always-loaded tools
     * configured in ToolSearchConfig (alwaysLoadedTools / alwaysLoadedCategories).
     * MCP clients call `tool.search` first to discover tools on-demand, dramatically
     * reducing context token usage for registries with 110+ tools.
     *
     * Requires the system prompt to instruct the client to use tool.search.
     * See docs/examples/mcp-server-example.ts for the recommended prompt snippet.
     *
     * Default: false — all enabled tools sent upfront.
     */
    searchMode?: boolean;

    /**
     * Public base URL of this MCP server (e.g. 'https://mcp.example.com').
     * Only used when auth.mode is 'jwt'.
     *
     * When provided alongside jwt auth, the server mounts
     * /.well-known/oauth-protected-resource so MCP clients can
     * auto-discover which OAuth server issues tokens for this server.
     *
     * Ignored for static and custom auth modes.
     */
    serverUrl?: string;
}

export interface McpServerHandle {
    /** Stop the MCP server and release all resources. */
    stop(): Promise<void>;
    /** Number of tools currently exposed. */
    toolCount: number;
    /**
     * Actual bound port (HTTP transport only). Useful when port:0 is passed and
     * the OS assigns a free port — integration tests read this to know where to connect.
     * Always 0 for stdio transport.
     */
    port: number;
}
