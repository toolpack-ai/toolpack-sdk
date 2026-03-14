import { describe, it, expect } from 'vitest';
import { fsToolsProject } from './index.js';
import { ToolRegistry } from '../registry.js';

describe('fs-tools project', () => {
    it('should have a valid manifest', () => {
        expect(fsToolsProject.manifest.name).toBe('fs-tools');
        expect(fsToolsProject.manifest.version).toBe('1.0.0');
        expect(fsToolsProject.manifest.category).toBe('filesystem');
        expect(fsToolsProject.manifest.author).toBe('Sajeer');
    });

    it('should export 18 tools matching the manifest', () => {
        expect(fsToolsProject.tools).toHaveLength(fsToolsProject.manifest.tools.length);
        expect(fsToolsProject.tools).toHaveLength(18);
    });

    it('should have tool names matching the manifest list', () => {
        const exportedNames = fsToolsProject.tools.map(t => t.name).sort();
        const manifestNames = [...fsToolsProject.manifest.tools].sort();
        expect(exportedNames).toEqual(manifestNames);
    });

    it('should have all tools with an execute function', () => {
        for (const tool of fsToolsProject.tools) {
            expect(typeof tool.execute).toBe('function');
        }
    });

    it('should have all tools in the filesystem category', () => {
        for (const tool of fsToolsProject.tools) {
            expect(tool.category).toBe('filesystem');
        }
    });

    it('should have unique tool names', () => {
        const names = fsToolsProject.tools.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('should have all tools with parameters defined', () => {
        for (const tool of fsToolsProject.tools) {
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
        }
    });

    it('should declare dependencies', () => {
        expect(fsToolsProject.dependencies).toBeDefined();
        expect(Object.keys(fsToolsProject.dependencies!)).toHaveLength(1);
        expect(fsToolsProject.dependencies!['fast-glob']).toBe('^3.3.2');
    });

    it('should have all dependencies resolvable', async () => {
        const registry = new ToolRegistry();
        const missing = await registry.validateDependencies(fsToolsProject);
        expect(missing).toHaveLength(0);
    });
});
