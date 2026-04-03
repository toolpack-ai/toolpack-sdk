# MCP Integration Guide

This document explains how to integrate Model Context Protocol (MCP) tool servers into Toolpack SDK.

- `createMcpToolProject(config)` loads MCP server tools into a `ToolProject`.
- `disconnectMcpToolProject(project)` disconnects servers and cleans up.
- Use `Toolpack.init({ tools: true, customTools: [mcpTools] })` to register MCP tools with your agent.

## 1. What is MCP?

MCP is a standard that exposes tools from external services through a common API. Toolpack supports the MCP toolflow with a built-in `mcp-tools` module.

## 2. Configure your MCP servers

```ts
import { createMcpToolProject, Toolpack } from 'toolpack';

const mcpConfig = {
  servers: [
    {
      name: 'chrome',
      displayName: 'Chrome DevTools',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp'],
      autoConnect: true,
      toolPrefix: 'mcp.chrome.',
    },
  ],
  defaultTimeoutMs: 30000,
  autoReconnect: true,
};

const mcpTools = await createMcpToolProject(mcpConfig);

const sdk = await Toolpack.init({
  provider: 'openai',
  tools: true,
  customTools: [mcpTools],
});
```

## 3. Run and inspect MCP tool list

```ts
const loadedTools = await sdk.listTools();
console.log('MCP tools', loadedTools.filter(t => t.category === 'mcp').map(t => t.name));
```

## 4. Use MCP tools in prompts

Toolpack's workflow engine and Tool Search supports MCP tools automatically as long as they are registered.

```ts
const response = await sdk.generate('Open Chrome and check the page source via the MCP tool.');
console.log(response.content);
```

## 5. Clean up

```ts
await disconnectMcpToolProject(mcpTools);
await sdk.shutdown?.();
```

## 6. Advanced: combined mode + tool restrictions

- Create a custom mode to restrict MCP tools to particular workflows.
- Use `modeOverrides` and tool filtering fields in `ToolpackInitConfig`.

## 7. Links & References

- examples/mcp-integration-example.ts
- README.md (MCP Tools section)
- Workflow engine docs: docs/WORKFLOW.md (if present)
