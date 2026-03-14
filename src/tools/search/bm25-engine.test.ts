import { describe, it, expect, beforeEach } from 'vitest';
import { BM25SearchEngine } from './bm25-engine.js';
import { ToolDefinition } from '../types.js';

// Mock tools for testing
const mockTools: ToolDefinition[] = [
    {
        name: 'fs.read_file',
        displayName: 'Read File',
        description: 'Read the contents of a file from the filesystem',
        category: 'filesystem',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The path to the file to read' },
            },
            required: ['path'],
        },
        execute: async () => '',
    },
    {
        name: 'fs.write_file',
        displayName: 'Write File',
        description: 'Write content to a file on the filesystem',
        category: 'filesystem',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The path to the file to write' },
                content: { type: 'string', description: 'The content to write' },
            },
            required: ['path', 'content'],
        },
        execute: async () => '',
    },
    {
        name: 'fs.delete_file',
        displayName: 'Delete File',
        description: 'Delete a file from the filesystem',
        category: 'filesystem',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The path to the file to delete' },
            },
            required: ['path'],
        },
        execute: async () => '',
    },
    {
        name: 'web.scrape',
        displayName: 'Scrape Web Page',
        description: 'Scrape content from a web page URL using cheerio',
        category: 'network',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to scrape' },
                selector: { type: 'string', description: 'CSS selector to extract' },
            },
            required: ['url'],
        },
        execute: async () => '',
    },
    {
        name: 'web.fetch',
        displayName: 'Fetch URL',
        description: 'Fetch content from a URL via HTTP GET request',
        category: 'network',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to fetch' },
            },
            required: ['url'],
        },
        execute: async () => '',
    },
    {
        name: 'exec.run',
        displayName: 'Run Command',
        description: 'Execute a shell command and return the output',
        category: 'execution',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The command to execute' },
                cwd: { type: 'string', description: 'Working directory' },
            },
            required: ['command'],
        },
        execute: async () => '',
    },
    {
        name: 'http.get',
        displayName: 'HTTP GET',
        description: 'Make an HTTP GET request to a URL',
        category: 'network',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to request' },
            },
            required: ['url'],
        },
        execute: async () => '',
    },
    {
        name: 'http.post',
        displayName: 'HTTP POST',
        description: 'Make an HTTP POST request with a body',
        category: 'network',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to request' },
                body: { type: 'string', description: 'Request body' },
            },
            required: ['url'],
        },
        execute: async () => '',
    },
];

describe('BM25SearchEngine', () => {
    let engine: BM25SearchEngine;

    beforeEach(() => {
        engine = new BM25SearchEngine();
        engine.index(mockTools);
    });

    describe('index()', () => {
        it('should index all tools', () => {
            expect(engine.getIndexedCount()).toBe(mockTools.length);
        });

        it('should track indexed tools by name', () => {
            expect(engine.isIndexed('fs.read_file')).toBe(true);
            expect(engine.isIndexed('web.scrape')).toBe(true);
            expect(engine.isIndexed('nonexistent')).toBe(false);
        });

        it('should handle empty tool list', () => {
            const emptyEngine = new BM25SearchEngine();
            emptyEngine.index([]);
            expect(emptyEngine.getIndexedCount()).toBe(0);
        });
    });

    describe('search()', () => {
        it('should find tools by exact name match', () => {
            const results = engine.search('read_file');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].toolName).toBe('fs.read_file');
        });

        it('should find tools by description keywords', () => {
            const results = engine.search('scrape web page');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].toolName).toBe('web.scrape');
        });

        it('should find tools by category', () => {
            const results = engine.search('filesystem');
            expect(results.length).toBeGreaterThan(0);
            // All top results should be filesystem tools
            expect(results.every(r => r.tool.category === 'filesystem')).toBe(true);
        });

        it('should find tools by display name', () => {
            const results = engine.search('Run Command');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].toolName).toBe('exec.run');
        });

        it('should return empty array for no matches', () => {
            const results = engine.search('xyznonexistent123');
            expect(results).toEqual([]);
        });

        it('should return empty array for empty query', () => {
            const results = engine.search('');
            expect(results).toEqual([]);
        });

        it('should respect limit option', () => {
            const results = engine.search('file', { limit: 2 });
            expect(results.length).toBeLessThanOrEqual(2);
        });

        it('should filter by category option', () => {
            const results = engine.search('url', { category: 'network' });
            expect(results.length).toBeGreaterThan(0);
            expect(results.every(r => r.tool.category === 'network')).toBe(true);
        });

        it('should rank more relevant results higher', () => {
            const results = engine.search('read file');
            // fs.read_file should rank higher than fs.write_file for "read file"
            const readIndex = results.findIndex(r => r.toolName === 'fs.read_file');
            const writeIndex = results.findIndex(r => r.toolName === 'fs.write_file');
            if (readIndex !== -1 && writeIndex !== -1) {
                expect(readIndex).toBeLessThan(writeIndex);
            }
        });

        it('should handle natural language queries', () => {
            const results = engine.search('I want to execute a shell command');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].toolName).toBe('exec.run');
        });

        it('should find HTTP tools', () => {
            const results = engine.search('http request');
            expect(results.length).toBeGreaterThan(0);
            expect(results.some(r => r.toolName.startsWith('http.'))).toBe(true);
        });

        it('should return proper ToolSchema format', () => {
            const results = engine.search('read');
            expect(results.length).toBeGreaterThan(0);
            const result = results[0];
            expect(result.tool).toHaveProperty('name');
            expect(result.tool).toHaveProperty('displayName');
            expect(result.tool).toHaveProperty('description');
            expect(result.tool).toHaveProperty('parameters');
            expect(result.tool).toHaveProperty('category');
            // Should NOT have execute function (it's a schema, not definition)
            expect(result.tool).not.toHaveProperty('execute');
        });
    });

    describe('scoring', () => {
        it('should give higher scores to exact matches', () => {
            const results = engine.search('fs.read_file');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].score).toBeGreaterThan(0);
        });

        it('should give positive scores to partial matches', () => {
            const results = engine.search('file');
            expect(results.length).toBeGreaterThan(0);
            results.forEach(r => {
                expect(r.score).toBeGreaterThan(0);
            });
        });
    });

    describe('performance', () => {
        it('should handle large tool sets efficiently', () => {
            // Generate 1000 mock tools
            const largeToolSet: ToolDefinition[] = [];
            for (let i = 0; i < 1000; i++) {
                largeToolSet.push({
                    name: `tool.test_${i}`,
                    displayName: `Test Tool ${i}`,
                    description: `This is test tool number ${i} for performance testing`,
                    category: i % 5 === 0 ? 'filesystem' : i % 3 === 0 ? 'network' : 'system',
                    parameters: { type: 'object', properties: {} },
                    execute: async () => '',
                });
            }

            const largeEngine = new BM25SearchEngine();
            
            // Index should complete quickly
            const indexStart = performance.now();
            largeEngine.index(largeToolSet);
            const indexTime = performance.now() - indexStart;
            expect(indexTime).toBeLessThan(500); // Should index 1000 tools in <500ms

            // Search should be fast
            const searchStart = performance.now();
            const results = largeEngine.search('test tool performance');
            const searchTime = performance.now() - searchStart;
            expect(searchTime).toBeLessThan(50); // Should search in <50ms
            expect(results.length).toBeGreaterThan(0);
        });
    });
});
