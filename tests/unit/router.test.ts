import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRouter } from '../../src/tools/router.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ToolDefinition, ToolParameters, ToolsConfig, DEFAULT_TOOLS_CONFIG, DEFAULT_TOOL_SEARCH_CONFIG } from '../../src/tools/types.js';
import { TOOL_SEARCH_NAME } from '../../src/tools/search/index.js';

function makeTool(name: string, category: string): ToolDefinition {
    const params: ToolParameters = {
        type: 'object',
        properties: {
            input: { type: 'string', description: 'test input' },
        },
        required: ['input'],
    };

    return {
        name,
        displayName: name,
        description: `Test tool: ${name}`,
        parameters: params,
        category,
        execute: async () => 'ok',
    };
}

describe('ToolRouter', () => {
    let router: ToolRouter;
    let registry: ToolRegistry;

    beforeEach(() => {
        router = new ToolRouter();
        registry = new ToolRegistry();
        registry.register(makeTool('fs.read_file', 'filesystem'));
        registry.register(makeTool('fs.write_file', 'filesystem'));
        registry.register(makeTool('exec.run', 'execution'));
        registry.register(makeTool('http.get', 'network'));
        registry.register(makeTool('web.search', 'network'));
    });

    // ── Disabled ─────────────────────────────────────────────────

    it('should return empty array when tools are disabled', async () => {
        const config: ToolsConfig = { ...DEFAULT_TOOLS_CONFIG, enabled: false };
        const schemas = await router.resolve([], registry, config);
        expect(schemas).toHaveLength(0);
    });

    // ── Legacy Mode ──────────────────────────────────────────────

    describe('Legacy Mode (toolSearch disabled)', () => {
        it('should return all tools when enabledTools and enabledCategories are empty', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: { ...DEFAULT_TOOL_SEARCH_CONFIG, enabled: false },
                enabledTools: [],
                enabledToolCategories: [],
            };
            const schemas = await router.resolve([], registry, config);
            expect(schemas).toHaveLength(5);
        });

        it('should filter by enabledTools names only', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: { ...DEFAULT_TOOL_SEARCH_CONFIG, enabled: false },
                enabledTools: ['fs.read_file', 'exec.run'],
                enabledToolCategories: [],
            };
            const schemas = await router.resolve([], registry, config);
            expect(schemas).toHaveLength(2);
            expect(schemas.map(s => s.name)).toContain('fs.read_file');
            expect(schemas.map(s => s.name)).toContain('exec.run');
        });

        it('should filter by enabledToolCategories only', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: { ...DEFAULT_TOOL_SEARCH_CONFIG, enabled: false },
                enabledTools: [],
                enabledToolCategories: ['filesystem'],
            };
            const schemas = await router.resolve([], registry, config);
            expect(schemas).toHaveLength(2);
            for (const s of schemas) {
                expect(s.category).toBe('filesystem');
            }
        });

        it('should deduplicate when tool appears in both lists', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: { ...DEFAULT_TOOL_SEARCH_CONFIG, enabled: false },
                enabledTools: ['fs.read_file'],
                enabledToolCategories: ['filesystem'],
            };
            const schemas = await router.resolve([], registry, config);
            const names = schemas.map(s => s.name);
            const uniqueNames = [...new Set(names)];
            expect(names.length).toBe(uniqueNames.length);
        });

        it('should return schemas without execute function', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: { ...DEFAULT_TOOL_SEARCH_CONFIG, enabled: false },
            };
            const schemas = await router.resolve([], registry, config);
            for (const schema of schemas) {
                expect('execute' in schema).toBe(false);
                expect(schema.name).toBeDefined();
                expect(schema.parameters).toBeDefined();
            }
        });
    });

    // ── Tool Search Mode ─────────────────────────────────────────

    describe('Tool Search Mode (toolSearch enabled)', () => {
        it('should always include tool.search schema', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: {
                    ...DEFAULT_TOOL_SEARCH_CONFIG,
                    enabled: true,
                    alwaysLoadedTools: [],
                    alwaysLoadedCategories: [],
                },
            };
            const schemas = await router.resolve([], registry, config);
            expect(schemas.map(s => s.name)).toContain(TOOL_SEARCH_NAME);
        });

        it('should include alwaysLoadedTools', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: {
                    ...DEFAULT_TOOL_SEARCH_CONFIG,
                    enabled: true,
                    alwaysLoadedTools: ['fs.read_file', 'web.search'],
                    alwaysLoadedCategories: [],
                },
            };
            const schemas = await router.resolve([], registry, config);
            const names = schemas.map(s => s.name);
            expect(names).toContain(TOOL_SEARCH_NAME);
            expect(names).toContain('fs.read_file');
            expect(names).toContain('web.search');
        });

        it('should include alwaysLoadedCategories', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: {
                    ...DEFAULT_TOOL_SEARCH_CONFIG,
                    enabled: true,
                    alwaysLoadedTools: [],
                    alwaysLoadedCategories: ['filesystem'],
                },
            };
            const schemas = await router.resolve([], registry, config);
            const names = schemas.map(s => s.name);
            expect(names).toContain('fs.read_file');
            expect(names).toContain('fs.write_file');
        });

        it('should deduplicate across always-loaded tools and categories', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: {
                    ...DEFAULT_TOOL_SEARCH_CONFIG,
                    enabled: true,
                    alwaysLoadedTools: ['fs.read_file'],
                    alwaysLoadedCategories: ['filesystem'],
                },
            };
            const schemas = await router.resolve([], registry, config);
            const names = schemas.map(s => s.name);
            const uniqueNames = [...new Set(names)];
            expect(names.length).toBe(uniqueNames.length);
        });

        it('should not include tools not in alwaysLoaded or discovered', async () => {
            const config: ToolsConfig = {
                ...DEFAULT_TOOLS_CONFIG,
                toolSearch: {
                    ...DEFAULT_TOOL_SEARCH_CONFIG,
                    enabled: true,
                    alwaysLoadedTools: ['fs.read_file'],
                    alwaysLoadedCategories: [],
                },
            };
            const schemas = await router.resolve([], registry, config);
            const names = schemas.map(s => s.name);
            expect(names).not.toContain('exec.run');
            expect(names).not.toContain('http.get');
        });
    });

    // ── Discovery Cache ──────────────────────────────────────────

    describe('Discovery Cache', () => {
        it('should return a discovery cache', () => {
            const cache = router.getDiscoveryCache();
            expect(cache).toBeDefined();
        });

        it('should clear the discovery cache', () => {
            router.clearDiscoveryCache();
            const cache = router.getDiscoveryCache();
            expect(cache.getDiscoveredTools()).toHaveLength(0);
        });
    });
});
