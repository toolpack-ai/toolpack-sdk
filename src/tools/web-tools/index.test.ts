import { describe, it, expect } from 'vitest';
import { webToolsProject } from './index.js';
import { ToolRegistry } from '../registry.js';

describe('web-tools project', () => {
    it('should have a valid manifest', () => {
        expect(webToolsProject.manifest.name).toBe('web-tools');
        expect(webToolsProject.manifest.version).toBe('1.0.0');
        expect(webToolsProject.manifest.category).toBe('network');
        expect(webToolsProject.manifest.author).toBe('Sajeer');
    });

    it('should export 9 tools matching the manifest', () => {
        expect(webToolsProject.tools).toHaveLength(webToolsProject.manifest.tools.length);
        expect(webToolsProject.tools).toHaveLength(9);
    });

    it('should have tool names matching the manifest list', () => {
        const exportedNames = webToolsProject.tools.map(t => t.name).sort();
        const manifestNames = [...webToolsProject.manifest.tools].sort();
        expect(exportedNames).toEqual(manifestNames);
    });

    it('should have all tools with an execute function', () => {
        for (const tool of webToolsProject.tools) {
            expect(typeof tool.execute).toBe('function');
        }
    });

    it('should have all tools in the network category', () => {
        for (const tool of webToolsProject.tools) {
            expect(tool.category).toBe('network');
        }
    });

    it('should have unique tool names', () => {
        const names = webToolsProject.tools.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('should have all tools with parameters defined', () => {
        for (const tool of webToolsProject.tools) {
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
        }
    });

    it('should declare cheerio as a dependency', () => {
        expect(webToolsProject.dependencies).toBeDefined();
        expect(webToolsProject.dependencies!['cheerio']).toBeDefined();
        expect(Object.keys(webToolsProject.dependencies!)).toHaveLength(1);
    });

    it('should have all dependencies resolvable', async () => {
        const registry = new ToolRegistry();
        const missing = await registry.validateDependencies(webToolsProject);
        expect(missing).toHaveLength(0);
    });
});
