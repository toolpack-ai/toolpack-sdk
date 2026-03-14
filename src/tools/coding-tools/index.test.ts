import { describe, it, expect } from 'vitest';
import { codingToolsProject } from './index.js';
import { ToolRegistry } from '../registry.js';

describe('coding-tools project', () => {
    it('should have a valid manifest', () => {
        expect(codingToolsProject.manifest.name).toBe('coding-tools');
        expect(codingToolsProject.manifest.version).toBe('1.0.0');
        expect(codingToolsProject.manifest.category).toBe('coding');
        expect(codingToolsProject.manifest.author).toBe('Sajeer');
    });

    it('should export 12 tools matching the manifest', () => {
        expect(codingToolsProject.tools).toHaveLength(codingToolsProject.manifest.tools.length);
        expect(codingToolsProject.tools).toHaveLength(12);
    });

    it('should have tool names matching the manifest list', () => {
        const exportedNames = codingToolsProject.tools.map(t => t.name).sort();
        const manifestNames = [...codingToolsProject.manifest.tools].sort();
        expect(exportedNames).toEqual(manifestNames);
    });

    it('should have all tools with an execute function', () => {
        for (const tool of codingToolsProject.tools) {
            expect(typeof tool.execute).toBe('function');
        }
    });

    it('should have all tools in the coding category', () => {
        for (const tool of codingToolsProject.tools) {
            expect(tool.category).toBe('coding');
        }
    });

    it('should have unique tool names', () => {
        const names = codingToolsProject.tools.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('should have all tools with parameters defined', () => {
        for (const tool of codingToolsProject.tools) {
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
        }
    });

    it('should declare dependencies', () => {
        const deps = codingToolsProject.dependencies;
        expect(deps).toBeDefined();
        expect(Object.keys(deps ?? {})).toHaveLength(3);
        expect(deps?.['@babel/parser']).toBe('^7.24.0');
        expect(deps?.['@babel/traverse']).toBe('^7.24.0');
        expect(deps?.['@babel/types']).toBe('^7.24.0');
    });

    it('should have all dependencies resolvable', async () => {
        const registry = new ToolRegistry();
        const missing = await registry.validateDependencies(codingToolsProject);
        expect(missing).toHaveLength(0);
    });
});
