import { describe, it, expect } from 'vitest';
import { systemToolsProject } from './index.js';
import { ToolRegistry } from '../registry.js';

describe('system-tools project', () => {
    it('should have a valid manifest', () => {
        expect(systemToolsProject.manifest.name).toBe('system-tools');
        expect(systemToolsProject.manifest.version).toBe('1.0.0');
        expect(systemToolsProject.manifest.category).toBe('system');
        expect(systemToolsProject.manifest.author).toBe('Sajeer');
    });

    it('should export 5 tools matching the manifest', () => {
        expect(systemToolsProject.tools).toHaveLength(systemToolsProject.manifest.tools.length);
        expect(systemToolsProject.tools).toHaveLength(5);
    });

    it('should have tool names matching the manifest list', () => {
        const exportedNames = systemToolsProject.tools.map(t => t.name).sort();
        const manifestNames = [...systemToolsProject.manifest.tools].sort();
        expect(exportedNames).toEqual(manifestNames);
    });

    it('should have all tools with an execute function', () => {
        for (const tool of systemToolsProject.tools) {
            expect(typeof tool.execute).toBe('function');
        }
    });

    it('should have all tools in the system category', () => {
        for (const tool of systemToolsProject.tools) {
            expect(tool.category).toBe('system');
        }
    });

    it('should have unique tool names', () => {
        const names = systemToolsProject.tools.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('should have all tools with parameters defined', () => {
        for (const tool of systemToolsProject.tools) {
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
        }
    });

    it('should declare dependencies', () => {
        expect(systemToolsProject.dependencies).toBeDefined();
        expect(Object.keys(systemToolsProject.dependencies!)).toHaveLength(0);
    });

    it('should have all dependencies resolvable', async () => {
        const registry = new ToolRegistry();
        const missing = await registry.validateDependencies(systemToolsProject);
        expect(missing).toHaveLength(0);
    });
});
