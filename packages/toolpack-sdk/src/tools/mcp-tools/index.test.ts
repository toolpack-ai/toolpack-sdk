import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock the MCP client module with a factory function
vi.mock('../../mcp/client.js', async () => {
    const { EventEmitter } = await import('events');
    
    class MockMcpClient extends EventEmitter {
        connected = false;
        
        constructor(private config: any) {
            super();
        }
        
        async connect(): Promise<void> {
            this.connected = true;
            this.emit('connected');
        }
        
        async disconnect(): Promise<void> {
            this.connected = false;
            this.emit('close', 0);
        }
        
        async request(method: string): Promise<any> {
            if (method === 'initialize') {
                return { initialized: true };
            }

            if (method === 'tools/list') {
                return {
                    tools: [
                        {
                            name: 'test_tool',
                            description: 'A test tool',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    input: { type: 'string', description: 'Test input' },
                                },
                                required: ['input'],
                            },
                        },
                        {
                            name: 'another_tool',
                            description: 'Another test tool',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    value: { type: 'number', description: 'Test value' },
                                },
                                required: ['value'],
                            },
                        },
                    ],
                };
            }
            throw new Error(`Unknown method: ${method}`);
        }
        
        async callTool(name: string, args: any): Promise<any> {
            return { result: `Executed ${name} with ${JSON.stringify(args)}` };
        }
    }
    
    return {
        McpClient: MockMcpClient,
    };
});

// Import after mocking
import { McpToolManager, createMcpToolProject, disconnectMcpToolProject, McpServerConfig, McpToolsConfig } from './index.js';

describe('McpToolManager', () => {
    let manager: McpToolManager;
    
    afterEach(async () => {
        if (manager) {
            await manager.disconnectAll();
        }
    });
    
    describe('Server Connection', () => {
        it('should connect to a single MCP server', async () => {
            const config: McpToolsConfig = {
                servers: [],
                defaultTimeoutMs: 30000,
            };
            
            manager = new McpToolManager(config);
            
            const serverConfig: McpServerConfig = {
                name: 'test-server',
                displayName: 'Test Server',
                command: 'node',
                args: ['test-server.js'],
            };
            
            await manager.connectServer(serverConfig);
            
            expect(manager.isServerConnected('test-server')).toBe(true);
            expect(manager.getConnectedServers()).toContain('test-server');
        });
        
        it('should connect to multiple servers', async () => {
            const config: McpToolsConfig = {
                servers: [
                    {
                        name: 'server1',
                        command: 'node',
                        args: ['server1.js'],
                    },
                    {
                        name: 'server2',
                        command: 'node',
                        args: ['server2.js'],
                    },
                ],
            };
            
            manager = new McpToolManager(config);
            await manager.connectAll();
            
            expect(manager.getConnectedServers()).toHaveLength(2);
            expect(manager.isServerConnected('server1')).toBe(true);
            expect(manager.isServerConnected('server2')).toBe(true);
        });
        
        it('should skip servers with autoConnect: false', async () => {
            const config: McpToolsConfig = {
                servers: [
                    {
                        name: 'auto-server',
                        command: 'node',
                        args: ['auto.js'],
                        autoConnect: true,
                    },
                    {
                        name: 'manual-server',
                        command: 'node',
                        args: ['manual.js'],
                        autoConnect: false,
                    },
                ],
            };
            
            manager = new McpToolManager(config);
            await manager.connectAll();
            
            expect(manager.isServerConnected('auto-server')).toBe(true);
            expect(manager.isServerConnected('manual-server')).toBe(false);
        });
    });
    
    describe('Tool Discovery', () => {
        it('should discover tools from connected server', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };
            
            manager = new McpToolManager(config);
            
            const serverConfig: McpServerConfig = {
                name: 'test-server',
                command: 'node',
                args: ['test.js'],
            };
            
            await manager.connectServer(serverConfig);
            
            const tools = manager.getToolDefinitions();
            expect(tools.length).toBeGreaterThan(0);
        });
        
        it('should prefix tool names correctly', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };
            
            manager = new McpToolManager(config);
            
            const serverConfig: McpServerConfig = {
                name: 'test-server',
                command: 'node',
                args: ['test.js'],
                toolPrefix: 'custom.prefix.',
            };
            
            await manager.connectServer(serverConfig);
            
            const tools = manager.getToolDefinitions();
            for (const tool of tools) {
                expect(tool.name).toMatch(/^custom\.prefix\./);
            }
        });
        
        it('should use default prefix when not specified', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };
            
            manager = new McpToolManager(config);
            
            const serverConfig: McpServerConfig = {
                name: 'myserver',
                command: 'node',
                args: ['test.js'],
            };
            
            await manager.connectServer(serverConfig);
            
            const tools = manager.getToolDefinitions();
            for (const tool of tools) {
                expect(tool.name).toMatch(/^mcp\.myserver\./);
            }
        });
        
        it('should convert MCP tool schema to Toolpack format', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };
            
            manager = new McpToolManager(config);
            
            const serverConfig: McpServerConfig = {
                name: 'test-server',
                command: 'node',
                args: ['test.js'],
            };
            
            await manager.connectServer(serverConfig);
            
            const tools = manager.getToolDefinitions();
            expect(tools.length).toBeGreaterThan(0);
            
            const tool = tools[0];
            expect(tool.name).toBeDefined();
            expect(tool.description).toBeDefined();
            expect(tool.category).toBe('mcp');
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
            expect(tool.execute).toBeDefined();
            expect(typeof tool.execute).toBe('function');
        });
    });
    
    describe('Server Disconnection', () => {
        it('should disconnect from a specific server', async () => {
            const config: McpToolsConfig = {
                servers: [
                    {
                        name: 'server1',
                        command: 'node',
                        args: ['s1.js'],
                    },
                    {
                        name: 'server2',
                        command: 'node',
                        args: ['s2.js'],
                    },
                ],
            };
            
            manager = new McpToolManager(config);
            await manager.connectAll();
            
            expect(manager.isServerConnected('server1')).toBe(true);
            expect(manager.isServerConnected('server2')).toBe(true);
            
            await manager.disconnectServer('server1');
            
            expect(manager.isServerConnected('server1')).toBe(false);
            expect(manager.isServerConnected('server2')).toBe(true);
        });
        
        it('should remove tools when disconnecting server', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };
            
            manager = new McpToolManager(config);
            
            await manager.connectServer({
                name: 'test-server',
                command: 'node',
                args: ['test.js'],
            });
            
            const toolsBefore = manager.getToolDefinitions();
            expect(toolsBefore.length).toBeGreaterThan(0);
            
            await manager.disconnectServer('test-server');
            
            const toolsAfter = manager.getToolDefinitions();
            const serverTools = toolsAfter.filter(t => t.name.includes('test-server'));
            expect(serverTools).toHaveLength(0);
        });

        it('should only remove exact server tools when disconnecting', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };

            manager = new McpToolManager(config);

            await manager.connectServer({
                name: 'test',
                command: 'node',
                args: ['test.js'],
            });

            await manager.connectServer({
                name: 'test-server',
                command: 'node',
                args: ['test.js'],
            });

            await manager.disconnectServer('test');

            const toolsAfter = manager.getToolDefinitions();
            const exactServerTools = toolsAfter.filter(t => t.name.startsWith('mcp.test-server.'));
            expect(exactServerTools.length).toBeGreaterThan(0);

            const removedTools = toolsAfter.filter(t => t.name.startsWith('mcp.test.'));
            expect(removedTools.every(t => t.name.startsWith('mcp.test-server.'))).toBe(true);
        });
        
        it('should disconnect from all servers', async () => {
            const config: McpToolsConfig = {
                servers: [
                    {
                        name: 'server1',
                        command: 'node',
                        args: ['s1.js'],
                    },
                    {
                        name: 'server2',
                        command: 'node',
                        args: ['s2.js'],
                    },
                ],
            };
            
            manager = new McpToolManager(config);
            await manager.connectAll();
            
            expect(manager.getConnectedServers()).toHaveLength(2);
            
            await manager.disconnectAll();
            
            expect(manager.getConnectedServers()).toHaveLength(0);
            expect(manager.isServerConnected('server1')).toBe(false);
            expect(manager.isServerConnected('server2')).toBe(false);
        });
        
        it('should handle disconnecting non-existent server gracefully', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };
            
            manager = new McpToolManager(config);
            
            // Should not throw
            await expect(manager.disconnectServer('nonexistent')).resolves.not.toThrow();
        });
    });
    
    describe('Tool Execution', () => {
        it('should execute MCP tools successfully', async () => {
            const config: McpToolsConfig = {
                servers: [],
            };
            
            manager = new McpToolManager(config);
            
            await manager.connectServer({
                name: 'test-server',
                command: 'node',
                args: ['test.js'],
            });
            
            const tools = manager.getToolDefinitions();
            expect(tools.length).toBeGreaterThan(0);
            
            const tool = tools[0];
            const result = await tool.execute({ input: 'test' });
            
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });

        it('should refresh tools after reconnecting', async () => {
            const config: McpToolsConfig = {
                servers: [
                    {
                        name: 'test-server',
                        command: 'node',
                        args: ['test.js'],
                    },
                ],
            };

            manager = new McpToolManager(config);
            await manager.connectServer(config.servers[0]);

            const client = (manager as any).clients.get('test-server');
            client.request = async (method: string): Promise<any> => {
                if (method === 'tools/list') {
                    return {
                        tools: [
                            {
                                name: 'updated_tool',
                                description: 'Updated tool after reconnect',
                                inputSchema: { type: 'object', properties: {}, required: [] },
                            },
                        ],
                    };
                }

                if (method === 'initialize') {
                    return { initialized: true };
                }
                throw new Error(`Unknown method: ${method}`);
            };

            client.emit('reconnected', { attempt: 1 });
            await new Promise(resolve => setTimeout(resolve, 0));

            const tools = manager.getToolDefinitions();
            expect(tools.some(t => t.name.includes('updated_tool'))).toBe(true);
            expect(tools.some(t => t.name.includes('test_tool'))).toBe(false);
        });
    });
});

describe('createMcpToolProject', () => {
    it('should create a tool project from MCP config', async () => {
        const config: McpToolsConfig = {
            servers: [
                {
                    name: 'test-server',
                    displayName: 'Test Server',
                    command: 'node',
                    args: ['test.js'],
                },
            ],
        };
        
        const project = await createMcpToolProject(config);
        
        expect(project).toBeDefined();
        expect(project.manifest).toBeDefined();
        expect(project.manifest.name).toBe('mcp-tools');
        expect(project.manifest.category).toBe('mcp');
        expect(project.tools).toBeDefined();
        expect(Array.isArray(project.tools)).toBe(true);
        
        // Cleanup
        await disconnectMcpToolProject(project);
    });
    
    it('should include manager in project metadata', async () => {
        const config: McpToolsConfig = {
            servers: [
                {
                    name: 'test-server',
                    command: 'node',
                    args: ['test.js'],
                },
            ],
        };
        
        const project = await createMcpToolProject(config) as any;
        
        expect(project.mcpManager).toBeDefined();
        expect(project.mcpManager).toBeInstanceOf(McpToolManager);
        
        // Cleanup
        await disconnectMcpToolProject(project);
    });
    
    it('should handle empty server list', async () => {
        const config: McpToolsConfig = {
            servers: [],
        };
        
        const project = await createMcpToolProject(config);
        
        expect(project.tools).toHaveLength(0);
        
        // Cleanup
        await disconnectMcpToolProject(project);
    });
    
    it('should handle multiple servers', async () => {
        const config: McpToolsConfig = {
            servers: [
                {
                    name: 'server1',
                    command: 'node',
                    args: ['s1.js'],
                },
                {
                    name: 'server2',
                    command: 'node',
                    args: ['s2.js'],
                },
            ],
        };
        
        const project = await createMcpToolProject(config);
        
        expect(project.tools.length).toBeGreaterThan(0);
        
        const manager = (project as any).mcpManager;
        expect(manager.getConnectedServers()).toHaveLength(2);
        
        // Cleanup
        await disconnectMcpToolProject(project);
    });
});

describe('disconnectMcpToolProject', () => {
    it('should disconnect all servers in project', async () => {
        const config: McpToolsConfig = {
            servers: [
                {
                    name: 'test-server',
                    command: 'node',
                    args: ['test.js'],
                },
            ],
        };
        
        const project = await createMcpToolProject(config);
        const manager = (project as any).mcpManager;
        
        expect(manager.getConnectedServers()).toHaveLength(1);
        
        await disconnectMcpToolProject(project);
        
        expect(manager.getConnectedServers()).toHaveLength(0);
    });
    
    it('should handle projects without manager gracefully', async () => {
        const project: any = {
            manifest: { name: 'test', version: '1.0.0', category: 'test', tools: [] },
            tools: [],
        };
        
        // Should not throw
        await expect(disconnectMcpToolProject(project)).resolves.not.toThrow();
    });
});

describe('MCP Integration with Toolpack', () => {
    it('should integrate MCP tools with tool registry', async () => {
        const config: McpToolsConfig = {
            servers: [
                {
                    name: 'test-server',
                    command: 'node',
                    args: ['test.js'],
                },
            ],
        };
        
        const project = await createMcpToolProject(config);
        
        // Verify tools can be registered
        expect(project.tools).toBeDefined();
        expect(project.tools.length).toBeGreaterThan(0);
        
        // Verify tool structure matches Toolpack requirements
        for (const tool of project.tools) {
            expect(tool.name).toBeDefined();
            expect(tool.description).toBeDefined();
            expect(tool.category).toBe('mcp');
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
            expect(typeof tool.execute).toBe('function');
        }
        
        // Cleanup
        await disconnectMcpToolProject(project);
    });
    
    it('should support custom tool prefixes', async () => {
        const config: McpToolsConfig = {
            servers: [
                {
                    name: 'chrome',
                    command: 'node',
                    args: ['chrome.js'],
                    toolPrefix: 'browser.',
                },
            ],
        };
        
        const project = await createMcpToolProject(config);
        
        for (const tool of project.tools) {
            expect(tool.name).toMatch(/^browser\./);
        }
        
        // Cleanup
        await disconnectMcpToolProject(project);
    });
    
    it('should handle server configuration options', async () => {
        const config: McpToolsConfig = {
            servers: [
                {
                    name: 'test-server',
                    displayName: 'Test Server',
                    command: 'node',
                    args: ['test.js'],
                    autoConnect: true,
                    toolPrefix: 'test.',
                    requestTimeoutMs: 5000,
                    autoReconnect: true,
                    maxReconnectAttempts: 5,
                    reconnectDelayMs: 2000,
                    env: {
                        TEST_VAR: 'test-value',
                    },
                },
            ],
            defaultTimeoutMs: 30000,
            autoReconnect: true,
        };
        
        const project = await createMcpToolProject(config);
        
        expect(project).toBeDefined();
        expect(project.tools.length).toBeGreaterThan(0);
        
        // Cleanup
        await disconnectMcpToolProject(project);
    });
});