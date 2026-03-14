import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ToolDefinition, ToolProject, ToolProjectManifest, ToolParameters, DEFAULT_TOOLS_CONFIG } from '../../src/tools/types.js';

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

function makeProject(name: string, tools: ToolDefinition[]): ToolProject {
    const manifest: ToolProjectManifest = {
        key: name,
        name,
        displayName: name,
        version: '1.0.0',
        description: `Test project: ${name}`,
        tools: tools.map(t => t.name),
        category: tools[0]?.category ?? 'test',
    };
    return { manifest, tools, dependencies: {} };
}

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    // ── Registration ─────────────────────────────────────────────

    it('should register a tool', () => {
        const tool = makeTool('test.tool', 'test');
        registry.register(tool);
        expect(registry.has('test.tool')).toBe(true);
        expect(registry.size).toBe(1);
    });

    it('should registerCustom identically to register', () => {
        const tool = makeTool('custom.tool', 'custom');
        registry.registerCustom(tool);
        expect(registry.has('custom.tool')).toBe(true);
    });

    it('should overwrite on duplicate registration', () => {
        const tool1 = makeTool('dup.tool', 'cat1');
        const tool2 = makeTool('dup.tool', 'cat2');
        registry.register(tool1);
        registry.register(tool2);
        expect(registry.size).toBe(1);
        expect(registry.get('dup.tool')?.category).toBe('cat2');
    });

    // ── Lookup ───────────────────────────────────────────────────

    it('should get a tool by name', () => {
        const tool = makeTool('lookup.tool', 'test');
        registry.register(tool);
        expect(registry.get('lookup.tool')?.name).toBe('lookup.tool');
    });

    it('should return undefined for unknown tool', () => {
        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should report has correctly', () => {
        registry.register(makeTool('exists', 'test'));
        expect(registry.has('exists')).toBe(true);
        expect(registry.has('nope')).toBe(false);
    });

    it('should return size', () => {
        expect(registry.size).toBe(0);
        registry.register(makeTool('a', 'test'));
        registry.register(makeTool('b', 'test'));
        expect(registry.size).toBe(2);
    });

    // ── Listing ──────────────────────────────────────────────────

    it('should return all tool names', () => {
        registry.register(makeTool('a', 'test'));
        registry.register(makeTool('b', 'test'));
        const names = registry.getNames();
        expect(names).toContain('a');
        expect(names).toContain('b');
        expect(names).toHaveLength(2);
    });

    it('should return all tools', () => {
        registry.register(makeTool('x', 'cat'));
        registry.register(makeTool('y', 'cat'));
        const all = registry.getAll();
        expect(all).toHaveLength(2);
    });

    // ── Category Filtering ───────────────────────────────────────

    it('should filter by single category', () => {
        registry.register(makeTool('fs.read', 'filesystem'));
        registry.register(makeTool('exec.run', 'execution'));
        registry.register(makeTool('fs.write', 'filesystem'));

        const fsList = registry.getByCategory('filesystem');
        expect(fsList).toHaveLength(2);
        for (const tool of fsList) {
            expect(tool.category).toBe('filesystem');
        }
    });

    it('should filter by multiple categories', () => {
        registry.register(makeTool('fs.read', 'filesystem'));
        registry.register(makeTool('exec.run', 'execution'));
        registry.register(makeTool('http.get', 'network'));

        const result = registry.getByCategories(['filesystem', 'network']);
        expect(result).toHaveLength(2);
    });

    it('should return empty for unknown category', () => {
        registry.register(makeTool('a', 'test'));
        expect(registry.getByCategory('nonexistent')).toHaveLength(0);
    });

    it('should list all categories', () => {
        registry.register(makeTool('a', 'cat1'));
        registry.register(makeTool('b', 'cat2'));
        registry.register(makeTool('c', 'cat1'));

        const cats = registry.getCategories();
        expect(cats).toContain('cat1');
        expect(cats).toContain('cat2');
        expect(cats).toHaveLength(2);
    });

    // ── getByNames ───────────────────────────────────────────────

    it('should get tools by specific names', () => {
        registry.register(makeTool('a', 'test'));
        registry.register(makeTool('b', 'test'));
        registry.register(makeTool('c', 'test'));

        const result = registry.getByNames(['a', 'c']);
        expect(result).toHaveLength(2);
        expect(result.map(t => t.name)).toEqual(['a', 'c']);
    });

    it('should skip unknown names in getByNames', () => {
        registry.register(makeTool('a', 'test'));
        const result = registry.getByNames(['a', 'unknown']);
        expect(result).toHaveLength(1);
    });

    // ── getEnabled ───────────────────────────────────────────────

    it('should return all tools when enabledTools and enabledToolCategories are empty', () => {
        registry.register(makeTool('a', 'test'));
        registry.register(makeTool('b', 'test'));
        registry.setConfig({ ...DEFAULT_TOOLS_CONFIG, enabledTools: [], enabledToolCategories: [] });

        const enabled = registry.getEnabled();
        expect(enabled).toHaveLength(2);
    });

    it('should filter by enabledTools', () => {
        registry.register(makeTool('a', 'test'));
        registry.register(makeTool('b', 'test'));
        registry.register(makeTool('c', 'test'));
        registry.setConfig({ ...DEFAULT_TOOLS_CONFIG, enabledTools: ['a', 'c'], enabledToolCategories: [] });

        const enabled = registry.getEnabled();
        expect(enabled).toHaveLength(2);
        expect(enabled.map(t => t.name)).toContain('a');
        expect(enabled.map(t => t.name)).toContain('c');
    });

    it('should filter by enabledToolCategories', () => {
        registry.register(makeTool('a', 'cat1'));
        registry.register(makeTool('b', 'cat2'));
        registry.setConfig({ ...DEFAULT_TOOLS_CONFIG, enabledTools: [], enabledToolCategories: ['cat1'] });

        const enabled = registry.getEnabled();
        expect(enabled).toHaveLength(1);
        expect(enabled[0]?.name).toBe('a');
    });

    it('should deduplicate when tool matches both name and category', () => {
        registry.register(makeTool('a', 'cat1'));
        registry.register(makeTool('b', 'cat1'));
        registry.setConfig({ ...DEFAULT_TOOLS_CONFIG, enabledTools: ['a'], enabledToolCategories: ['cat1'] });

        const enabled = registry.getEnabled();
        // 'a' appears via both enabledTools and enabledToolCategories, should appear once
        const names = enabled.map(t => t.name);
        const uniqueNames = [...new Set(names)];
        expect(names.length).toBe(uniqueNames.length);
    });

    // ── Schemas ──────────────────────────────────────────────────

    it('should return schemas without the execute function', () => {
        registry.register(makeTool('schematest', 'test'));
        const schemas = registry.getSchemas();
        expect(schemas).toHaveLength(1);
        expect(schemas[0]?.name).toBe('schematest');
        // Schema should NOT have execute
        expect('execute' in (schemas[0] ?? {})).toBe(false);
    });

    it('should return schemas for specific tool names', () => {
        registry.register(makeTool('a', 'test'));
        registry.register(makeTool('b', 'test'));
        registry.register(makeTool('c', 'test'));

        const schemas = registry.getSchemas(['a', 'c']);
        expect(schemas).toHaveLength(2);
        expect(schemas.map(s => s.name)).toEqual(['a', 'c']);
    });

    // ── Config ───────────────────────────────────────────────────

    it('should set and get config', () => {
        const config = { ...DEFAULT_TOOLS_CONFIG, maxToolRounds: 99 };
        registry.setConfig(config);
        expect(registry.getConfig().maxToolRounds).toBe(99);
    });

    // ── Projects ─────────────────────────────────────────────────

    it('should load a project and register its tools', async () => {
        const tools = [makeTool('proj.a', 'proj'), makeTool('proj.b', 'proj')];
        const project = makeProject('test-project', tools);

        await registry.loadProject(project);
        expect(registry.has('proj.a')).toBe(true);
        expect(registry.has('proj.b')).toBe(true);
        expect(registry.size).toBe(2);
    });

    it('should track loaded projects', async () => {
        const project = makeProject('tracked', [makeTool('t', 'test')]);
        await registry.loadProject(project);

        expect(registry.getProject('tracked')).toBeDefined();
        expect(registry.getProjectNames()).toContain('tracked');
        expect(registry.getProjects()).toHaveLength(1);
    });

    it('should load multiple projects', async () => {
        const p1 = makeProject('p1', [makeTool('p1.a', 'test')]);
        const p2 = makeProject('p2', [makeTool('p2.a', 'test')]);
        await registry.loadProjects([p1, p2]);

        expect(registry.size).toBe(2);
        expect(registry.getProjectNames()).toHaveLength(2);
    });

    it('should load all built-in projects', async () => {
        await registry.loadBuiltIn();
        // Should load multiple projects with many tools
        expect(registry.size).toBeGreaterThan(10);
        expect(registry.getProjectNames().length).toBeGreaterThanOrEqual(3);
        // fs-tools and web-tools should always be present
        expect(registry.has('fs.read_file')).toBe(true);
        expect(registry.has('web.search')).toBe(true);
    });

    // ── Dependency Validation ────────────────────────────────────

    it('should validate dependencies with no missing packages', async () => {
        const project = makeProject('no-deps', [makeTool('t', 'test')]);
        project.dependencies = {};
        const missing = await registry.validateDependencies(project);
        expect(missing).toHaveLength(0);
    });
});
