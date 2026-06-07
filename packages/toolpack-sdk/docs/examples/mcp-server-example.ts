/**
 * Toolpack MCP Server — entry point example
 *
 * Exposes Toolpack's 110+ built-in tools as an MCP server so any MCP-compatible
 * client (Claude Desktop, Cursor, Windsurf, custom agents) can use them.
 *
 * Prerequisites:
 *   npm install toolpack-sdk @modelcontextprotocol/sdk
 *
 * ─── stdio transport (Claude Desktop / Cursor) ────────────────────────────────
 *
 * 1. Run this file: node mcp-server-example.js
 * 2. Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
 *
 *    {
 *      "mcpServers": {
 *        "toolpack": {
 *          "command": "node",
 *          "args": ["/absolute/path/to/mcp-server-example.js"]
 *        }
 *      }
 *    }
 *
 * ─── HTTP transport (remote / hosted) ────────────────────────────────────────
 *
 * Set TOOLPACK_MCP_TRANSPORT=http and TOOLPACK_MCP_PORT=3000 to run as an HTTP server.
 * MCP clients connect to http://localhost:3000.
 *
 * Always set MCP_AUTH_MODE when using HTTP outside of localhost.
 * Supported values: 'static', 'jwt', 'none' (localhost only, not recommended in production)
 */

import { Toolpack } from 'toolpack-sdk';
import type { McpAuthConfig } from 'toolpack-sdk';

const transport = (process.env.TOOLPACK_MCP_TRANSPORT ?? 'stdio') as 'stdio' | 'http';
const port = Number(process.env.TOOLPACK_MCP_PORT ?? 3000);

const sdk = await Toolpack.init({
    provider: 'anthropic',
    tools: true,
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Auth configuration ───────────────────────────────────────────────────────
// Auth is only enforced on the HTTP transport. stdio is process-isolated.
// When transport is 'http' and no auth is set, a warning is logged and all
// requests are accepted — safe for localhost only.

function buildAuth(): McpAuthConfig | undefined {
    const mode = process.env.MCP_AUTH_MODE;

    if (mode === 'static') {
        // Pre-shared bearer token — suitable for self-hosted / dev deployments.
        // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
        const token = process.env.MCP_TOKEN;
        if (!token) throw new Error('MCP_TOKEN env var required for static auth mode');
        return { mode: 'static', tokens: [token] };
    }

    if (mode === 'jwt') {
        // JWT verification via JWKS — works with Auth0, Supabase, Clerk, Keycloak, etc.
        const jwksUrl = process.env.MCP_JWKS_URL;
        if (!jwksUrl) throw new Error('MCP_JWKS_URL env var required for jwt auth mode');
        return {
            mode: 'jwt',
            jwksUrl,
            audience: process.env.MCP_JWT_AUDIENCE,   // e.g. 'https://your-mcp-server.example.com'
            issuer:   process.env.MCP_JWT_ISSUER,      // e.g. 'https://your-tenant.auth0.com/'
        };
    }

    // No auth — open server. Only safe on localhost.
    return undefined;
}

// ─── Start server ─────────────────────────────────────────────────────────────

const handle = await sdk.startMcpServer({
    transport,
    port,
    auth: buildAuth(),

    // Optional: advertise which OAuth server issues tokens for this server.
    // Only used with jwt auth mode — enables MCP client auto-discovery.
    serverUrl: process.env.MCP_SERVER_URL,   // e.g. 'https://your-mcp-server.example.com'

    // Optional: search mode — dramatically reduces context token usage for 110+ tools.
    // tools/list returns only `tool.search` + always-loaded tools.
    // Clients call tool.search to discover tools on-demand instead of loading all upfront.
    //
    // Requires this addition to your system prompt:
    //   "You have access to a large library of tools via tool.search.
    //    Before calling any tool that is not already listed, call tool.search
    //    with a short description of what you want to do."
    //
    // searchMode: true,

    // Optional: expose only specific tool categories instead of all 110+ tools
    // expose: { categories: ['filesystem', 'github', 'slack', 'database'] },

    // Optional: expose specific tools by name
    // expose: { tools: ['fs.read_file', 'fs.write_file', 'slack.chat.postMessage'] },
});

console.error(
    `Toolpack MCP server started — ${handle.toolCount} tools exposed over ${transport}` +
    (transport === 'http' ? ` on port ${port}` : ''),
);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
    await handle.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await handle.stop();
    process.exit(0);
});
