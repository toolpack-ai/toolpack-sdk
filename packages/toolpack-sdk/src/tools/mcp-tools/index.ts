/**
 * MCP Tools Integration
 * 
 * Bridges Model Context Protocol (MCP) servers into the Toolpack tool system.
 * Allows MCP tools to be used alongside built-in tools with full support for
 * modes, workflow engine, and tool search.
 */

import { McpClient, McpClientConfig } from '../../mcp/client.js';
import { McpTool } from '../../mcp/types.js';
import { ToolDefinition, ToolProject } from '../types.js';
import { logInfo, logWarn, logError } from '../../providers/provider-logger.js';

export interface McpServerConfig extends McpClientConfig {
    /** Unique name for this MCP server */
    name: string;
    
    /** Display name for UI */
    displayName?: string;
    
    /** Whether to auto-connect on initialization */
    autoConnect?: boolean;
    
    /** Tool name prefix (default: "mcp.<server-name>.") */
    toolPrefix?: string;
}

export interface McpToolsConfig {
    /** List of MCP servers to connect to */
    servers: McpServerConfig[];
    
    /** Global timeout for MCP requests in ms (default: 30000) */
    defaultTimeoutMs?: number;
    
    /** Enable auto-reconnection for all servers (default: true) */
    autoReconnect?: boolean;
}

/**
 * Manages MCP server connections and tool registration
 */
export class McpToolManager {
    private clients = new Map<string, McpClient>();
    private serverConfigs = new Map<string, McpServerConfig>();
    private toolDefinitions = new Map<string, ToolDefinition>();
    private toolOwners = new Map<string, string>();
    
    constructor(private config: McpToolsConfig) {}
    
    /**
     * Connect to a single MCP server and discover its tools
     */
    async connectServer(serverConfig: McpServerConfig): Promise<void> {
        const { name, displayName, toolPrefix, ...clientConfig } = serverConfig;
        
        logInfo(`[MCP] Connecting to server: ${displayName || name}`);
        
        try {
            const client = new McpClient({
                ...clientConfig,
                requestTimeoutMs: clientConfig.requestTimeoutMs ?? this.config.defaultTimeoutMs,
                autoReconnect: clientConfig.autoReconnect ?? this.config.autoReconnect ?? true,
            });
            
            // Set up event handlers
            this.setupClientEvents(client, name);
            
            // Connect to the server
            await client.connect();
            
            this.clients.set(name, client);
            this.serverConfigs.set(name, serverConfig);
            await this.discoverServerTools(name, client, serverConfig);
            
        } catch (error) {
            logError(`[MCP] Failed to connect to ${name}: ${error}`);
            throw error;
        }
    }
    
    /**
     * Connect to all configured servers
     */
    async connectAll(): Promise<void> {
        const promises = this.config.servers
            .filter(s => s.autoConnect !== false)
            .map(s => this.connectServer(s));
        
        await Promise.allSettled(promises);
    }
    
    /**
     * Disconnect from a specific server
     */
    async disconnectServer(name: string): Promise<void> {
        const client = this.clients.get(name);
        if (!client) {
            logWarn(`[MCP] Server ${name} not found`);
            return;
        }
        
        logInfo(`[MCP] Disconnecting from ${name}`);
        
        // Remove tools from this server
        for (const [toolName, owner] of this.toolOwners) {
            if (owner === name) {
                this.toolDefinitions.delete(toolName);
                this.toolOwners.delete(toolName);
            }
        }
        
        await client.disconnect();
        this.clients.delete(name);
        this.serverConfigs.delete(name);
    }
    
    /**
     * Disconnect from all servers
     */
    async disconnectAll(): Promise<void> {
        const promises = Array.from(this.clients.keys()).map(name => 
            this.disconnectServer(name)
        );
        await Promise.allSettled(promises);
    }
    
    /**
     * Get all tool definitions from all connected servers
     */
    getToolDefinitions(): ToolDefinition[] {
        return Array.from(this.toolDefinitions.values());
    }
    
    /**
     * Get list of connected server names
     */
    getConnectedServers(): string[] {
        return Array.from(this.clients.keys());
    }
    
    /**
     * Check if a server is connected
     */
    isServerConnected(name: string): boolean {
        const client = this.clients.get(name);
        return client?.connected ?? false;
    }
    
    /**
     * Convert an MCP tool to a Toolpack tool definition
     */
    private convertMcpTool(
        mcpTool: McpTool,
        serverName: string,
        prefix: string,
        client: McpClient
    ): ToolDefinition {
        // Ensure parameters conform to ToolParameters type
        const parameters = {
            type: 'object' as const,
            properties: mcpTool.inputSchema.properties || {},
            required: mcpTool.inputSchema.required || [],
        };

        return {
            name: `${prefix}${mcpTool.name}`,
            displayName: mcpTool.name,
            description: mcpTool.description || `MCP tool from ${serverName}`,
            category: 'mcp',
            parameters,
            execute: async (args: Record<string, any>) => {
                try {
                    logInfo(`[MCP] Executing ${mcpTool.name} on ${serverName}`);
                    const result = await client.callTool(mcpTool.name, args);
                    return JSON.stringify(result);
                } catch (error) {
                    logError(`[MCP] Tool execution failed: ${error}`);
                    throw error;
                }
            },
        };
    }
    
    /**
     * Set up event handlers for an MCP client
     */
    private setupClientEvents(client: McpClient, serverName: string): void {
        client.on('error', (error: any) => {
            logError(`[MCP] ${serverName} error: ${error}`);
        });
        
        client.on('close', (code: any) => {
            logWarn(`[MCP] ${serverName} closed with code ${code}`);
        });
        
        client.on('reconnecting', ({ attempt, max }: any) => {
            logInfo(`[MCP] ${serverName} reconnecting (${attempt}/${max})`);
        });
        
        client.on('reconnected', ({ attempt }: any) => {
            logInfo(`[MCP] ${serverName} reconnected after ${attempt} attempts`);
            this.refreshServerTools(serverName).catch(err => {
                logError(`[MCP] ${serverName} tool refresh failed after reconnect: ${err}`);
            });
        });
        
        client.on('reconnect_failed', (attempts: any) => {
            logError(`[MCP] ${serverName} failed to reconnect after ${attempts} attempts`);
        });
        
        client.on('notification', (message: any) => {
            logInfo(`[MCP] ${serverName} notification: ${JSON.stringify(message)}`);
        });
    }

    private removeServerToolDefinitions(serverName: string): void {
        for (const [toolName, owner] of this.toolOwners) {
            if (owner === serverName) {
                this.toolDefinitions.delete(toolName);
                this.toolOwners.delete(toolName);
            }
        }
    }

    private async discoverServerTools(
        serverName: string,
        client: McpClient,
        serverConfig: McpServerConfig
    ): Promise<void> {
        const toolsResponse = await client.request('tools/list');
        const mcpTools: McpTool[] = toolsResponse?.tools || [];

        logInfo(`[MCP] Discovered ${mcpTools.length} tools from ${serverName}`);

        this.removeServerToolDefinitions(serverName);

        const prefix = serverConfig.toolPrefix || `mcp.${serverName}.`;
        for (const mcpTool of mcpTools) {
            const toolDef = this.convertMcpTool(mcpTool, serverName, prefix, client);
            this.toolDefinitions.set(toolDef.name, toolDef);
            this.toolOwners.set(toolDef.name, serverName);
        }
    }

    private async refreshServerTools(serverName: string): Promise<void> {
        const client = this.clients.get(serverName);
        const serverConfig = this.serverConfigs.get(serverName);
        if (!client || !serverConfig) return;

        await this.discoverServerTools(serverName, client, serverConfig);
    }
}

export interface McpToolProject extends ToolProject {
    mcpManager: McpToolManager;
}

/**
 * Create an MCP tool project from server configurations
 * 
 * @example
 * ```typescript
 * const mcpTools = await createMcpToolProject({
 *   servers: [
 *     {
 *       name: 'chrome',
 *       displayName: 'Chrome DevTools',
 *       command: 'npx',
 *       args: ['-y', 'chrome-devtools-mcp'],
 *     },
 *     {
 *       name: 'filesystem',
 *       displayName: 'Filesystem',
 *       command: 'npx',
 *       args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
 *     },
 *   ],
 * });
 * 
 * const sdk = await Toolpack.init({
 *   provider: 'openai',
 *   tools: true,
 *   customTools: [mcpTools],
 * });
 * ```
 */
export async function createMcpToolProject(
    config: McpToolsConfig
): Promise<McpToolProject> {
    const manager = new McpToolManager(config);
    
    // Connect to all servers
    await manager.connectAll();
    
    // Get all tool definitions
    const tools = manager.getToolDefinitions();
    
    const project: McpToolProject = {
        manifest: {
            key: 'mcp-tools',
            name: 'mcp-tools',
            displayName: 'MCP Tools',
            version: '1.0.0',
            description: `Tools from ${manager.getConnectedServers().length} MCP server(s)`,
            category: 'mcp',
            author: 'Toolpack SDK',
            tools: tools.map(t => t.name),
        },
        tools,
        mcpManager: manager,
    };
    
    return project;
}

/**
 * Disconnect all MCP servers in a tool project
 */
export async function disconnectMcpToolProject(project: ToolProject | McpToolProject): Promise<void> {
    if ('mcpManager' in project) {
        await project.mcpManager.disconnectAll();
    }
}