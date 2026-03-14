import { describe, it, expect } from 'vitest';
import { execToolsProject } from './index.js';
import { ToolRegistry } from '../registry.js';

describe('exec-tools project', () => {
    it('should have a valid manifest', () => {
        expect(execToolsProject.manifest.name).toBe('exec-tools');
        expect(execToolsProject.manifest.version).toBe('1.0.0');
        expect(execToolsProject.manifest.category).toBe('execution');
        expect(execToolsProject.manifest.author).toBe('Sajeer');
    });

    it('should export 6 tools matching the manifest', () => {
        expect(execToolsProject.tools).toHaveLength(execToolsProject.manifest.tools.length);
        expect(execToolsProject.tools).toHaveLength(6);
    });

    it('should have tool names matching the manifest list', () => {
        const exportedNames = execToolsProject.tools.map(t => t.name).sort();
        const manifestNames = [...execToolsProject.manifest.tools].sort();
        expect(exportedNames).toEqual(manifestNames);
    });

    it('should have all tools with an execute function', () => {
        for (const tool of execToolsProject.tools) {
            expect(typeof tool.execute).toBe('function');
        }
    });

    it('should have all tools in the execution category', () => {
        for (const tool of execToolsProject.tools) {
            expect(tool.category).toBe('execution');
        }
    });

    it('should have unique tool names', () => {
        const names = execToolsProject.tools.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('should have all tools with parameters defined', () => {
        for (const tool of execToolsProject.tools) {
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe('object');
        }
    });

    it('should declare dependencies', () => {
        expect(execToolsProject.dependencies).toBeDefined();
        expect(Object.keys(execToolsProject.dependencies!)).toHaveLength(0);
    });

    it('should have all dependencies resolvable', async () => {
        const registry = new ToolRegistry();
        const missing = await registry.validateDependencies(execToolsProject);
        expect(missing).toHaveLength(0);
    });
});
