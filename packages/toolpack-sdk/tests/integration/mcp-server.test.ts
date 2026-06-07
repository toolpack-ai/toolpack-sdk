/**
 * MCP Server — HTTP integration tests
 *
 * Spins up a real HTTP MCP server on port 0 (OS-assigned), sends real JSON-RPC
 * requests via fetch, and asserts on the responses. No mocking.
 *
 * Run with:  npx vitest run tests/integration/mcp-server.test.ts
 *
 * Requires ANTHROPIC_API_KEY (or any provider key) — the server only routes
 * tool *definitions* (not LLM calls) for these tests, so the key just needs
 * to be non-empty for Toolpack.init() to succeed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Toolpack } from '../../src/index.js';
import type { McpServerHandle } from '../../src/mcp/server-types.js';


// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * MCP client session. The Streamable HTTP transport is stateful:
 * - First call must be `initialize` to get a session ID
 * - All subsequent calls include the `mcp-session-id` header
 */
class McpSession {
    private sessionId?: string;
    constructor(private url: string, private authHeaders: Record<string, string> = {}) {}

    async initialize() {
        const res = await this.raw('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0' },
        });
        this.sessionId = res.sessionId;
        // Send initialized notification
        await fetch(this.url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        });
        return res;
    }

    async call(method: string, params: Record<string, unknown> = {}) {
        return this.raw(method, params);
    }

    private headers(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
            ...this.authHeaders,
        };
    }

    private async raw(method: string, params: Record<string, unknown>) {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });

        if (res.status === 401 || res.status === 403) {
            return { status: res.status, body: {}, sessionId: undefined };
        }

        const contentType = res.headers.get('content-type') ?? '';
        const sessionId = res.headers.get('mcp-session-id') ?? undefined;
        let body: Record<string, unknown>;

        if (contentType.includes('text/event-stream')) {
            const text = await res.text();
            const dataLine = text.split('\n').find(l => l.startsWith('data:'));
            body = dataLine ? JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown> : {};
        } else {
            body = await res.json() as Record<string, unknown>;
        }

        return { status: res.status, body, sessionId };
    }
}

/** Open a session and return it ready for tool calls. */
async function openSession(url: string, authHeaders: Record<string, string> = {}) {
    const session = new McpSession(url, authHeaders);
    await session.initialize();
    return session;
}

/** Raw fetch without session — for testing auth rejection before initialize. */
async function rawPost(url: string, headers: Record<string, string> = {}) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    return { status: res.status };
}

async function startServer(overrides: Partial<Parameters<Toolpack['startMcpServer']>[0]> = {}) {
    const searchMode = (overrides as Record<string, unknown>).searchMode === true;
    const sdk = await Toolpack.init({
        provider: 'anthropic',
        tools: true,
        apiKey: process.env.ANTHROPIC_API_KEY ?? 'test-key',
        // Enable tool search in the default mode when MCP server is in search mode
        ...(searchMode ? { modeOverrides: { default: { toolSearch: { enabled: true } } } } : {}),
    });
    const handle = await sdk.startMcpServer({
        transport: 'http',
        port: 0,
        ...overrides,
    } as Parameters<Toolpack['startMcpServer']>[0]);
    const url = `http://localhost:${handle.port}`;
    return { handle, url, sdk };
}

// ─── tests ────────────────────────────────────────────────────────────────────

// Cross-platform path to a file that always exists and contains 'localhost'
const HOSTS_FILE = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';

// Opt-in: set RUN_INTEGRATION_TESTS=1 to run. Skipped in CI by default.
describe.runIf(process.env.RUN_INTEGRATION_TESTS === '1')('MCP Server — HTTP integration', () => {
    describe('tools/list', () => {
        let handle: McpServerHandle;
        let session: McpSession;

        beforeAll(async () => {
            const s = await startServer();
            handle = s.handle;
            session = await openSession(s.url);
        });
        afterAll(() => handle.stop());

        it('returns 100+ tools', async () => {
            const { status, body } = await session.call('tools/list');
            expect(status).toBe(200);
            const result = body.result as { tools: unknown[] };
            expect(result.tools.length).toBeGreaterThan(100);
        });

        it('each tool has name, description, inputSchema', async () => {
            const { body } = await session.call('tools/list');
            const result = body.result as { tools: Record<string, unknown>[] };
            for (const tool of result.tools.slice(0, 5)) {
                expect(typeof tool.name).toBe('string');
                expect(typeof tool.description).toBe('string');
                expect(tool.inputSchema).toBeDefined();
            }
        });

        it('toolCount matches tools/list length', async () => {
            const { body } = await session.call('tools/list');
            const result = body.result as { tools: unknown[] };
            expect(handle.toolCount).toBe(result.tools.length);
        });
    });

    describe('tools/call', () => {
        let handle: McpServerHandle;
        let session: McpSession;

        beforeAll(async () => {
            const s = await startServer();
            handle = s.handle;
            session = await openSession(s.url);
        });
        afterAll(() => handle.stop());

        it('executes fs.read_file and returns real file content', async () => {
            const { status, body } = await session.call('tools/call', {
                name: 'fs.read_file',
                arguments: { path: HOSTS_FILE },
            });
            expect(status).toBe(200);
            const result = body.result as { content: Array<{ type: string; text: string }> };
            expect(result.content[0]?.type).toBe('text');
            expect(result.content[0]?.text).toContain('localhost');
        });

        it('returns isError:true for unknown tool', async () => {
            const { body } = await session.call('tools/call', {
                name: 'does.not.exist',
                arguments: {},
            });
            const result = body.result as { isError: boolean };
            expect(result.isError).toBe(true);
        });

        it('returns isError:true for tool execution error', async () => {
            const { body } = await session.call('tools/call', {
                name: 'fs.read_file',
                arguments: { path: '/this/path/does/not/exist/ever' },
            });
            const result = body.result as { isError: boolean };
            expect(result.isError).toBe(true);
        });
    });

    describe('static auth', () => {
        const TOKEN = 'integration-test-secret-token';
        let handle: McpServerHandle;
        let url: string;

        beforeAll(async () => {
            ({ handle, url } = await startServer({
                auth: { mode: 'static', tokens: [TOKEN] },
            }));
        });
        afterAll(() => handle.stop());

        it('rejects request with no token — HTTP 401', async () => {
            const { status } = await rawPost(url);
            expect(status).toBe(401);
        });

        it('rejects request with wrong token — HTTP 401', async () => {
            const { status } = await rawPost(url, { Authorization: 'Bearer wrong-token' });
            expect(status).toBe(401);
        });

        it('accepts request with correct token and lists tools', async () => {
            const session = await openSession(url, { Authorization: `Bearer ${TOKEN}` });
            const { status, body } = await session.call('tools/list');
            expect(status).toBe(200);
            const result = body.result as { tools: unknown[] };
            expect(result.tools.length).toBeGreaterThan(0);
        });
    });

    describe('search mode', () => {
        let handle: McpServerHandle;
        let session: McpSession;

        beforeAll(async () => {
            const s = await startServer({ searchMode: true });
            handle = s.handle;
            session = await openSession(s.url);
        });
        afterAll(() => handle.stop());

        it('tools/list returns only tool.search (+ always-loaded)', async () => {
            const { body } = await session.call('tools/list');
            const result = body.result as { tools: Array<{ name: string }> };
            const names = result.tools.map(t => t.name);
            expect(names).toContain('tool.search');
            expect(names).not.toContain('fs.read_file');
        });

        it('tool.search returns a JSON response with found and tools fields', async () => {
            const { status, body } = await session.call('tools/call', {
                name: 'tool.search',
                arguments: { query: 'git commit log' },
            });
            expect(status).toBe(200);
            const result = body.result as { content: Array<{ text: string }> };
            const text = result.content[0]?.text ?? '';
            const parsed = JSON.parse(text);
            expect(parsed).toHaveProperty('query');
            expect(parsed).toHaveProperty('found');
            expect(parsed).toHaveProperty('tools');
        });

        it('tool.search for git returns git tools', async () => {
            const { body } = await session.call('tools/call', {
                name: 'tool.search',
                arguments: { query: 'git commit log' },
            });
            const result = body.result as { content: Array<{ text: string }> };
            const text = result.content[0]?.text.toLowerCase() ?? '';
            expect(text).toContain('git');
        });
    });

    describe('expose config', () => {
        let handle: McpServerHandle;
        let session: McpSession;

        beforeAll(async () => {
            const s = await startServer({ expose: { categories: ['filesystem'] } });
            handle = s.handle;
            session = await openSession(s.url);
        });
        afterAll(() => handle.stop());

        it('only exposes tools from the specified category', async () => {
            const { body } = await session.call('tools/list');
            const result = body.result as { tools: Array<{ name: string }> };
            const names = result.tools.map(t => t.name);
            expect(names.every(n => n.startsWith('fs.'))).toBe(true);
            expect(names).not.toContain('git.commit');
            expect(names).not.toContain('slack.chat.postMessage');
        });
    });

    describe('port: 0 (OS-assigned port)', () => {
        it('handle.port is a non-zero number', async () => {
            const { handle } = await startServer();
            expect(handle.port).toBeGreaterThan(0);
            await handle.stop();
        });

        it('two servers on port:0 get different ports', async () => {
            const a = await startServer();
            const b = await startServer();
            expect(a.handle.port).not.toBe(b.handle.port);
            await Promise.all([a.handle.stop(), b.handle.stop()]);
        });
    });
});
