// MCP Module
// Client: JSON-RPC transport for consuming external MCP servers
// Server: expose Toolpack's built-in tools as an MCP server

// ─── Client ───────────────────────────────────────────────────────────────────
export { McpClient, McpClientConfig, McpTimeoutError, McpConnectionError } from './client.js';
export {
    JsonRpcRequest,
    JsonRpcResponse,
    McpTool,
    McpServerCapabilities,
} from './types.js';

// ─── Server ───────────────────────────────────────────────────────────────────
// startMcpServer() is intentionally NOT re-exported here. server.ts has static
// imports of @modelcontextprotocol/sdk (an optional peer dep). A static re-export
// would eagerly load those imports and break users who haven't installed the SDK.
// Use Toolpack.startMcpServer() instead — it gates the load behind a dynamic import.
export type {
    ToolpackMcpServerConfig,
    McpServerHandle,
    McpTransport,
    McpServerExposeConfig,
    McpAgentDefinition,
    McpAuthConfig,
    McpStaticAuthConfig,
    McpJwtAuthConfig,
    McpCustomAuthConfig,
    AuthInfo,
} from './server-types.js';
