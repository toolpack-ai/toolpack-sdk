// MCP Client Module
// Provides JSON-RPC transport for communicating with MCP servers (e.g., chrome-devtools-mcp)

export { McpClient, McpClientConfig, McpTimeoutError, McpConnectionError } from './client';
export {
    JsonRpcRequest,
    JsonRpcResponse,
    McpTool,
    McpServerCapabilities,
} from './types';
