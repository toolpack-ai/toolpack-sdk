import { Toolpack, createMcpToolProject } from '../../src';

/**
 * Example: Basic MCP server integration with Toolpack SDK
 *
 * Notes:
 * - Run this example after starting an MCP-compatible server.
 * - Each server config should point at an MCP socket or endpoint.
 * - The server must support the MCP `tools/list` and `tool/call` operations.
 */

async function main() {
  // 1. Define MCP servers
  const mcpConfig = {
    servers: [
      {
        name: 'example-server',
        displayName: 'MCP Example Server',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-example', '--port', '8080'],
        autoConnect: true,
      },
    ],
    defaultTimeoutMs: 30000,
    autoReconnect: true,
  };

  // 2. Create tool project for MCP tools
  const mcpToolProject = await createMcpToolProject(mcpConfig);

  // 3. Initialize Toolpack with MCP tools enabled
  const sdk = await Toolpack.init({
    provider: 'openai',
    tools: true,
    customTools: [mcpToolProject],
  });

  // 4. Query the tool registry for MCP tools
  const tools = await sdk.listTools();
  console.log('Loaded tools from MCP servers:', tools.filter(t => t.category === 'mcp').map(t => t.name));

  // 5. Example: use one mcp tool (replace 'mcp.example-tool' with actual tool name)
  const toolName = mcpToolProject.tools[0]?.name;
  if (!toolName) {
    throw new Error('No MCP tool loaded from server');
  }

  const response = await sdk.generate(`Use tool ${toolName} to provide a simple response.`, 'openai');
  console.log('AI output:', response.content);

  // 6. Teardown (disconnect MCP tools gracefully)
  await sdk.shutdown?.();
  await sdk.toolRegistry?.unloadProject?.(mcpToolProject); // if this API exists in your version
}

main().catch((err) => {
  console.error('MCP integration example failed:', err);
});
