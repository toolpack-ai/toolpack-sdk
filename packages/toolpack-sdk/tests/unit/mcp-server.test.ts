import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ToolDefinition } from '../../src/tools/types.js';
import type { ToolpackMcpServerConfig } from '../../src/mcp/server-types.js';

// ─── MCP SDK mocks ────────────────────────────────────────────────────────────
// We mock the entire SDK so no real transport (stdin/stdout, HTTP) is created.
// The fake Server captures setRequestHandler calls so we can invoke them directly.

type HandlerFn = (req: { params: Record<string, unknown> }) => Promise<unknown>;

// Captured state, reset per test
let capturedHandlers: Map<string, HandlerFn>;

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
    return {
        Server: class FakeServer {
            connect: ReturnType<typeof vi.fn>;
            close: ReturnType<typeof vi.fn>;
            constructor() {
                capturedHandlers = new Map();
                this.connect = vi.fn().mockResolvedValue(undefined);
                this.close = vi.fn().mockResolvedValue(undefined);
            }
            setRequestHandler(schema: { shape: { method: { _def: { value: string } } } }, handler: HandlerFn) {
                const method = schema?.shape?.method?._def?.value ?? String(schema);
                capturedHandlers.set(method, handler);
            }
        },
    };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class FakeStdio {},
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
    StreamableHTTPServerTransport: class FakeHttp {
        handleRequest = vi.fn();
    },
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
    ListToolsRequestSchema: { shape: { method: { _def: { value: 'tools/list' } } } },
    CallToolRequestSchema: { shape: { method: { _def: { value: 'tools/call' } } } },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return {
        name: 'test.tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        category: 'test',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
        },
        execute: vi.fn().mockResolvedValue('ok'),
        ...overrides,
    };
}

function makeRegistry(tools: ToolDefinition[] = []): ToolRegistry {
    const r = new ToolRegistry();
    for (const t of tools) r.register(t);
    return r;
}

async function callList() {
    const handler = capturedHandlers.get('tools/list');
    if (!handler) throw new Error('tools/list handler not registered');
    return handler({ params: {} }) as Promise<{ tools: { name: string; description: string; inputSchema: unknown; annotations?: Record<string, unknown> }[] }>;
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
    const handler = capturedHandlers.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');
    return handler({ params: { name, arguments: args } }) as Promise<{
        content: { type: string; text: string }[];
        isError: boolean;
    }>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('startMcpServer — unit', () => {
    let startMcpServer: (
        registry: ToolRegistry,
        config: ToolpackMcpServerConfig,
        searchFn?: (args: Record<string, unknown>) => string,
    ) => Promise<unknown>;

    beforeEach(async () => {
        vi.resetModules();
        ({ startMcpServer } = await import('../../src/mcp/server.js'));
    });

    // ── Search mode ───────────────────────────────────────────────────────────

    describe('search mode', () => {
        const threeTools = () => [
            makeTool({ name: 'fs.read', category: 'filesystem' }),
            makeTool({ name: 'slack.post', category: 'slack' }),
            makeTool({ name: 'gh.pr', category: 'github' }),
        ];

        it('tools/list returns tool.search as first entry when searchMode is true', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', searchMode: true });
            const result = await callList();
            expect(result.tools[0].name).toBe('tool.search');
        });

        it('tools/list does NOT include non-always-loaded tools in search mode', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', searchMode: true });
            const result = await callList();
            const names = result.tools.map(t => t.name);
            expect(names).not.toContain('fs.read');
            expect(names).not.toContain('slack.post');
            expect(names).not.toContain('gh.pr');
        });

        it('tools/list includes always-loaded tools alongside tool.search', async () => {
            const registry = makeRegistry(threeTools());
            registry.setConfig({
                enabled: true,
                autoExecute: true,
                maxToolRounds: 5,
                toolChoicePolicy: 'auto',
                resultMaxChars: 20_000,
                enabledTools: [],
                enabledToolCategories: [],
                toolSearch: {
                    enabled: true,
                    alwaysLoadedTools: ['fs.read'],
                    alwaysLoadedCategories: [],
                    searchResultLimit: 5,
                    cacheDiscoveredTools: true,
                },
            });
            await startMcpServer(registry, { transport: 'stdio', searchMode: true });
            const result = await callList();
            const names = result.tools.map(t => t.name);
            expect(names).toContain('tool.search');
            expect(names).toContain('fs.read');
            expect(names).not.toContain('slack.post');
        });

        it('tool.search entry has readOnlyHint annotation', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', searchMode: true });
            const result = await callList();
            expect(result.tools[0].annotations).toEqual({ readOnlyHint: true });
        });

        it('tools/list returns all tools when searchMode is false (default)', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            const names = result.tools.map(t => t.name);
            expect(names).not.toContain('tool.search');
            expect(names).toContain('fs.read');
            expect(names).toContain('slack.post');
            expect(names).toContain('gh.pr');
        });

        it('tools/call for tool.search invokes searchFn and returns result', async () => {
            const registry = makeRegistry(threeTools());
            const searchFn = vi.fn().mockReturnValue(JSON.stringify({ found: 1, tools: [{ name: 'fs.read' }] }));
            await startMcpServer(registry, { transport: 'stdio', searchMode: true }, searchFn);
            const result = await callTool('tool.search', { query: 'read file' });
            expect(searchFn).toHaveBeenCalledWith({ query: 'read file' });
            expect(result.isError).toBe(false);
            expect(result.content[0].text).toContain('fs.read');
        });

        it('tools/call for tool.search returns isError when searchFn throws', async () => {
            const registry = makeRegistry(threeTools());
            const searchFn = vi.fn().mockImplementation(() => { throw new Error('search failed'); });
            await startMcpServer(registry, { transport: 'stdio', searchMode: true }, searchFn);
            const result = await callTool('tool.search', { query: 'whatever' });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('search failed');
        });

        it('tools/call for tool.search returns isError when searchMode is true but searchFn missing', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', searchMode: true }); // no searchFn
            const result = await callTool('tool.search', { query: 'test' });
            expect(result.isError).toBe(true);
        });

        it('tools/call for tool.search falls through to "not found" when searchMode is false', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callTool('tool.search', { query: 'test' });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('tool.search');
        });
    });

    // ── Tool annotations ──────────────────────────────────────────────────────

    describe('tool annotations', () => {
        it('uses explicit annotations when set on the tool', async () => {
            const registry = makeRegistry([makeTool({
                name: 'x',
                annotations: { readOnlyHint: true, openWorldHint: false },
            })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            expect(result.tools[0].annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
        });

        it('derives { destructiveHint: true } when confirmation is set and no explicit annotations', async () => {
            const registry = makeRegistry([makeTool({
                name: 'x',
                confirmation: { level: 'high', reason: 'This will delete.' },
            })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            expect(result.tools[0].annotations).toEqual({ destructiveHint: true });
        });

        it('derives { destructiveHint: true } for confirmation.level medium as well', async () => {
            const registry = makeRegistry([makeTool({
                name: 'x',
                confirmation: { level: 'medium', reason: 'This will modify.' },
            })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            expect(result.tools[0].annotations).toEqual({ destructiveHint: true });
        });

        it('omits annotations entirely when neither annotations nor confirmation is set', async () => {
            // MCP spec defaults apply: destructiveHint=true, openWorldHint=true, readOnlyHint=false.
            // We must NOT claim readOnlyHint:true for tools we have no signal about
            // (e.g. slack.post, create-dir — not read-only but no confirmation set).
            const registry = makeRegistry([makeTool({ name: 'x' })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            expect(result.tools[0].annotations).toBeUndefined();
        });

        it('explicit annotations take priority over confirmation', async () => {
            // Tool has both — explicit annotations must win
            const registry = makeRegistry([makeTool({
                name: 'x',
                confirmation: { level: 'high', reason: 'danger' },
                annotations: { destructiveHint: false, idempotentHint: true },
            })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            expect(result.tools[0].annotations).toEqual({ destructiveHint: false, idempotentHint: true });
        });
    });

    // ── Schema translation ────────────────────────────────────────────────────

    describe('schema translation', () => {
        it('maps parameters → inputSchema in tools/list response', async () => {
            const params = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
            const registry = makeRegistry([makeTool({ name: 'fs.read_file', parameters: params })]);

            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();

            expect(result.tools).toHaveLength(1);
            expect(result.tools[0].name).toBe('fs.read_file');
            expect(result.tools[0].inputSchema).toEqual(params);
        });

        it('falls back to empty-object inputSchema when parameters is undefined', async () => {
            const tool = makeTool({ name: 'no.params' });
            // @ts-expect-error intentional: testing undefined parameters path
            delete tool.parameters;
            const registry = makeRegistry([tool]);

            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();

            expect(result.tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
        });

        it('preserves tool description in tools/list', async () => {
            const registry = makeRegistry([makeTool({ name: 'x', description: 'does something' })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            expect(result.tools[0].description).toBe('does something');
        });
    });

    // ── Agent exposure ────────────────────────────────────────────────────────

    describe('agent exposure', () => {
        const makeAgentDef = (name: string, overrides: Partial<{ description: string; inputSchema: Record<string, unknown>; invoke: () => Promise<string> }> = {}) => ({
            name,
            description: overrides.description ?? `${name} agent`,
            ...(overrides.inputSchema !== undefined && { inputSchema: overrides.inputSchema }),
            invoke: overrides.invoke ?? vi.fn().mockResolvedValue(`${name} result`),
        });

        it('tools/list includes agent entries as agent.<name>', async () => {
            const registry = makeRegistry([makeTool({ name: 'fs.read' })]);
            await startMcpServer(registry, { transport: 'stdio', agents: [makeAgentDef('pr_reviewer')] });
            const result = await callList();
            const names = result.tools.map(t => t.name);
            expect(names).toContain('agent.pr_reviewer');
        });

        it('agents coexist with regular tools in tools/list', async () => {
            const registry = makeRegistry([makeTool({ name: 'fs.read' })]);
            await startMcpServer(registry, { transport: 'stdio', agents: [makeAgentDef('pr_reviewer')] });
            const result = await callList();
            const names = result.tools.map(t => t.name);
            expect(names).toContain('fs.read');
            expect(names).toContain('agent.pr_reviewer');
        });

        it('agent entry uses provided inputSchema', async () => {
            const schema = { type: 'object', properties: { pr_url: { type: 'string' } }, required: ['pr_url'] };
            const registry = makeRegistry([]);
            await startMcpServer(registry, { transport: 'stdio', agents: [makeAgentDef('x', { inputSchema: schema })] });
            const result = await callList();
            expect(result.tools[0].inputSchema).toEqual(schema);
        });

        it('agent entry defaults to empty-object inputSchema when not provided', async () => {
            const registry = makeRegistry([]);
            await startMcpServer(registry, { transport: 'stdio', agents: [makeAgentDef('x')] });
            const result = await callList();
            expect(result.tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
        });

        it('tools/call invokes the agent and returns its output', async () => {
            const invoke = vi.fn().mockResolvedValue('LGTM!');
            const registry = makeRegistry([]);
            await startMcpServer(registry, { transport: 'stdio', agents: [makeAgentDef('pr_reviewer', { invoke })] });
            const result = await callTool('agent.pr_reviewer', { pr_url: 'https://github.com/...' });
            expect(invoke).toHaveBeenCalledWith({ pr_url: 'https://github.com/...' });
            expect(result.isError).toBe(false);
            expect(result.content[0].text).toBe('LGTM!');
        });

        it('tools/call returns isError when invoke() throws', async () => {
            const invoke = vi.fn().mockRejectedValue(new Error('agent failed'));
            const registry = makeRegistry([]);
            await startMcpServer(registry, { transport: 'stdio', agents: [makeAgentDef('x', { invoke })] });
            const result = await callTool('agent.x', {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('agent failed');
        });

        it('tools/call returns isError for unknown agent name', async () => {
            const registry = makeRegistry([]);
            await startMcpServer(registry, { transport: 'stdio', agents: [makeAgentDef('pr_reviewer')] });
            const result = await callTool('agent.unknown', {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('unknown');
        });

        it('agents appear in tools/list even when searchMode is true', async () => {
            // Agents are not in the ToolRegistry — tool.search cannot find them.
            // They must always be listed explicitly.
            const registry = makeRegistry([makeTool({ name: 'fs.read' })]);
            await startMcpServer(registry, {
                transport: 'stdio',
                searchMode: true,
                agents: [makeAgentDef('pr_reviewer')],
            });
            const result = await callList();
            const names = result.tools.map(t => t.name);
            expect(names).toContain('tool.search');
            expect(names).toContain('agent.pr_reviewer');
            expect(names).not.toContain('fs.read'); // regular tools deferred
        });

        it('tools/list has no agent entries when agents array is empty', async () => {
            const registry = makeRegistry([makeTool({ name: 'fs.read' })]);
            await startMcpServer(registry, { transport: 'stdio', agents: [] });
            const result = await callList();
            expect(result.tools.every(t => !t.name.startsWith('agent.'))).toBe(true);
        });

        it('multiple agents all appear in tools/list', async () => {
            const registry = makeRegistry([]);
            await startMcpServer(registry, {
                transport: 'stdio',
                agents: [makeAgentDef('pr_reviewer'), makeAgentDef('code_analyst')],
            });
            const result = await callList();
            const names = result.tools.map(t => t.name);
            expect(names).toContain('agent.pr_reviewer');
            expect(names).toContain('agent.code_analyst');
        });
    });

    // ── Tool filtering ────────────────────────────────────────────────────────

    describe('tool filtering', () => {
        const threeTools = () => [
            makeTool({ name: 'fs.read', category: 'filesystem' }),
            makeTool({ name: 'slack.post', category: 'slack' }),
            makeTool({ name: 'gh.pr', category: 'github' }),
        ];

        it('exposes all enabled tools when expose is omitted', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callList();
            expect(result.tools).toHaveLength(3);
        });

        it('filters by categories when expose.categories is set', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', expose: { categories: ['filesystem', 'slack'] } });
            const result = await callList();
            expect(result.tools.map(t => t.name).sort()).toEqual(['fs.read', 'slack.post']);
        });

        it('filters by exact names when expose.tools is set', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', expose: { tools: ['fs.read', 'gh.pr'] } });
            const result = await callList();
            expect(result.tools.map(t => t.name).sort()).toEqual(['fs.read', 'gh.pr']);
        });

        it('falls back to all enabled tools when expose.categories is an empty array', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', expose: { categories: [] } });
            const result = await callList();
            expect(result.tools).toHaveLength(3);
        });

        it('falls back to all enabled tools when expose.tools is an empty array', async () => {
            const registry = makeRegistry(threeTools());
            await startMcpServer(registry, { transport: 'stdio', expose: { tools: [] } });
            const result = await callList();
            expect(result.tools).toHaveLength(3);
        });
    });

    // ── Result translation ────────────────────────────────────────────────────

    describe('result translation', () => {
        it('wraps a string result in MCP content', async () => {
            const registry = makeRegistry([makeTool({ execute: vi.fn().mockResolvedValue('hello world') })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callTool('test.tool');
            expect(result.content).toEqual([{ type: 'text', text: 'hello world' }]);
            expect(result.isError).toBe(false);
        });

        it('JSON-stringifies an object result', async () => {
            const registry = makeRegistry([makeTool({ execute: vi.fn().mockResolvedValue({ files: ['a.ts', 'b.ts'] }) })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callTool('test.tool');
            expect(result.content[0].type).toBe('text');
            expect(JSON.parse(result.content[0].text)).toEqual({ files: ['a.ts', 'b.ts'] });
            expect(result.isError).toBe(false);
        });

        it('returns isError: true when execute() throws', async () => {
            const registry = makeRegistry([makeTool({ execute: vi.fn().mockRejectedValue(new Error('disk full')) })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callTool('test.tool');
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('disk full');
        });

        it('includes the tool name in the error message when execute() throws', async () => {
            const registry = makeRegistry([makeTool({ name: 'my.tool', execute: vi.fn().mockRejectedValue(new Error('boom')) })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callTool('my.tool');
            expect(result.content[0].text).toContain('my.tool');
        });
    });

    // ── Tool not found ────────────────────────────────────────────────────────

    describe('tool not found', () => {
        it('returns isError: true for an unknown tool name without throwing', async () => {
            const registry = makeRegistry([makeTool({ name: 'real.tool' })]);
            await startMcpServer(registry, { transport: 'stdio' });
            const result = await callTool('ghost.tool');
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('ghost.tool');
        });

        it('returns isError: true for a tool registered but excluded by expose.categories', async () => {
            const tools = [
                makeTool({ name: 'fs.read', category: 'filesystem' }),
                makeTool({ name: 'slack.post', category: 'slack' }),
            ];
            const registry = makeRegistry(tools);
            await startMcpServer(registry, { transport: 'stdio', expose: { categories: ['filesystem'] } });

            // slack.post is registered but not in the exposed category
            const result = await callTool('slack.post');
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('slack.post');
        });

        it('returns isError: true for a tool disabled in registry config (no expose filter set)', async () => {
            // Simulates: toolpack.config.json has enabledToolCategories: ['filesystem']
            // but the MCP server is started with no expose filter.
            // tools/call must not execute a tool outside the enabled set.
            const tools = [
                makeTool({ name: 'fs.read', category: 'filesystem' }),
                makeTool({ name: 'slack.post', category: 'slack' }),
            ];
            const registry = makeRegistry(tools);
            // Restrict the registry to only the 'filesystem' category
            registry.setConfig({
                enabled: true,
                autoExecute: true,
                maxToolRounds: 5,
                toolChoicePolicy: 'auto',
                resultMaxChars: 20_000,
                enabledTools: [],
                enabledToolCategories: ['filesystem'],
            });

            await startMcpServer(registry, { transport: 'stdio' }); // no expose filter
            const result = await callTool('slack.post');
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('slack.post');
        });

        it('returns isError: true for a tool disabled in registry config when expose arrays are empty', async () => {
            // expose = { categories: [] } falls back to getEnabled() in resolveTools.
            // resolveToolByName must do the same — not bypass the registry filter.
            const tools = [
                makeTool({ name: 'fs.read', category: 'filesystem' }),
                makeTool({ name: 'slack.post', category: 'slack' }),
            ];
            const registry = makeRegistry(tools);
            registry.setConfig({
                enabled: true,
                autoExecute: true,
                maxToolRounds: 5,
                toolChoicePolicy: 'auto',
                resultMaxChars: 20_000,
                enabledTools: [],
                enabledToolCategories: ['filesystem'],
            });

            // Empty array → falls back to registry enabled filter
            await startMcpServer(registry, { transport: 'stdio', expose: { categories: [] } });
            const result = await callTool('slack.post');
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('slack.post');
        });

        it('returns isError: true for a tool registered but excluded by expose.tools', async () => {
            const tools = [
                makeTool({ name: 'fs.read', category: 'filesystem' }),
                makeTool({ name: 'fs.write', category: 'filesystem' }),
            ];
            const registry = makeRegistry(tools);
            await startMcpServer(registry, { transport: 'stdio', expose: { tools: ['fs.read'] } });

            // fs.write is registered but not in the explicit allow-list
            const result = await callTool('fs.write');
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('fs.write');
        });
    });

    // ── Unknown transport ─────────────────────────────────────────────────────

    describe('unknown transport', () => {
        it('throws a descriptive error for an unsupported transport value', async () => {
            const registry = makeRegistry([makeTool()]);
            const config = { transport: 'grpc' } as unknown as ToolpackMcpServerConfig;
            await expect(startMcpServer(registry, config)).rejects.toThrow(/grpc/);
        });
    });

    // ── McpServerHandle ───────────────────────────────────────────────────────

    describe('McpServerHandle', () => {
        it('toolCount reflects the number of tools currently exposed', async () => {
            const tools = [
                makeTool({ name: 'a', category: 'x' }),
                makeTool({ name: 'b', category: 'x' }),
                makeTool({ name: 'c', category: 'y' }),
            ];
            const registry = makeRegistry(tools);
            const handle = await startMcpServer(registry, {
                transport: 'stdio',
                expose: { categories: ['x'] },
            }) as { toolCount: number; stop(): Promise<void> };
            expect(handle.toolCount).toBe(2);
        });

        it('uses custom serverName and serverVersion when provided', async () => {
            // Just verify startMcpServer resolves without throwing.
            const registry = makeRegistry([makeTool()]);
            await expect(
                startMcpServer(registry, { transport: 'stdio', serverName: 'My Server', serverVersion: '3.0.0' })
            ).resolves.toBeDefined();
        });
    });
});
