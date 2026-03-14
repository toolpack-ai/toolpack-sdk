import { describe, it, expect } from 'vitest';
import { httpToolsProject } from './index.js';
import { ToolRegistry } from '../registry.js';

describe('http-tools project', () => {
    it('should have a valid manifest', () => {
        expect(httpToolsProject.manifest.name).toBe('http-tools');
        expect(httpToolsProject.manifest.version).toBe('1.0.0');
        expect(httpToolsProject.manifest.category).toBe('network');
        expect(httpToolsProject.manifest.author).toBe('Sajeer');
    });

    it('should export 5 tools matching the manifest', () => {
        expect(httpToolsProject.tools).toHaveLength(httpToolsProject.manifest.tools.length);
        expect(httpToolsProject.tools).toHaveLength(5);
    });

    it('should have tool names matching the manifest list', () => {
        const exportedNames = httpToolsProject.tools.map(t => t.name).sort();
        const manifestNames = [...httpToolsProject.manifest.tools].sort();
        expect(exportedNames).toEqual(manifestNames);
    });

    it('should have all tools with an execute function', () => {
        for (const tool of httpToolsProject.tools) {
            expect(typeof tool.execute).toBe('function');
        }
    });

    it('should have all tools in the network category', () => {
        for (const tool of httpToolsProject.tools) {
            expect(tool.category).toBe('network');
        }
    });

    it('should have unique tool names', () => {
        const names = httpToolsProject.tools.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('should have all tools with parameters defined', () => {
        for (const tool of httpToolsProject.tools) {
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
        }
    });

    it('should declare dependencies', () => {
        expect(httpToolsProject.dependencies).toBeDefined();
        expect(Object.keys(httpToolsProject.dependencies!)).toHaveLength(0);
    });

    it('should have all dependencies resolvable', async () => {
        const registry = new ToolRegistry();
        const missing = await registry.validateDependencies(httpToolsProject);
        expect(missing).toHaveLength(0);
    });
});
