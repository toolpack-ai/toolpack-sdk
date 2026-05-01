import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Toolpack } from '../../src/toolpack.js';
import type { KnowledgeInstance } from '../../src/toolpack.js';
import type { RequestToolDefinition } from '../../src/types/index.js';

describe('Knowledge Tools Integration', () => {
  let mockKnowledge: KnowledgeInstance;
  let addedChunks: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>;

  beforeEach(() => {
    addedChunks = [];
    
    mockKnowledge = {
      toTool: vi.fn().mockReturnValue({
        name: 'knowledge_search',
        displayName: 'Knowledge Search',
        description: 'Search the knowledge base for relevant information',
        category: 'search',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Maximum results' },
          },
          required: ['query'],
        },
        execute: vi.fn().mockImplementation(async (args: { query: string; limit?: number }) => {
          // Simple search implementation for testing
          const results = addedChunks.filter(chunk => 
            chunk.content.toLowerCase().includes(args.query.toLowerCase())
          ).slice(0, args.limit || 5);
          
          return results.map(chunk => ({
            id: chunk.id,
            content: chunk.content,
            metadata: chunk.metadata,
            score: 0.9,
          }));
        }),
      }),
      add: vi.fn().mockImplementation(async (content: string, metadata?: Record<string, unknown>) => {
        const id = `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        addedChunks.push({ id, content, metadata });
        return id;
      }),
      query: vi.fn().mockResolvedValue([]),
      stop: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('knowledge_add tool', () => {
    it('should create knowledge_add tool when knowledge is configured', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: mockKnowledge,
      });

      // Access the private prepareRequest method for testing
      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      // Verify both knowledge tools are present
      expect(request.requestTools).toBeDefined();
      expect(request.requestTools).toHaveLength(2);
      
      const knowledgeSearchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      const knowledgeAddTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');
      
      expect(knowledgeSearchTool).toBeDefined();
      expect(knowledgeAddTool).toBeDefined();
    });

    it('should have correct structure for knowledge_add tool', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: mockKnowledge,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const knowledgeAddTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');
      
      expect(knowledgeAddTool).toMatchObject({
        name: 'knowledge_add',
        displayName: 'Add to Knowledge',
        description: 'Add important new information to the knowledge base for future reference.',
        category: 'knowledge',
      });

      expect(knowledgeAddTool?.parameters).toEqual({
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The content to add to the knowledge base.',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata such as source, category, or tags.',
          },
        },
        required: ['content'],
      });

      expect(typeof knowledgeAddTool?.execute).toBe('function');
    });

    it('should add content to knowledge base via knowledge_add tool', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: mockKnowledge,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const knowledgeAddTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');
      expect(knowledgeAddTool).toBeDefined();

      // Execute the tool to add content
      const result = await knowledgeAddTool!.execute({
        content: 'The API rate limit is 100 requests per minute',
        metadata: { source: 'documentation', category: 'api' },
      });

      // Verify add was called with correct arguments
      expect(mockKnowledge.add).toHaveBeenCalledWith(
        'The API rate limit is 100 requests per minute',
        { source: 'documentation', category: 'api' }
      );

      // Verify response structure
      expect(result).toMatchObject({
        success: true,
        message: 'Content added to knowledge base successfully.',
      });
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
    });

    it('should add content without metadata', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: mockKnowledge,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const knowledgeAddTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');
      
      const result = await knowledgeAddTool!.execute({
        content: 'Important information without metadata',
      });

      expect(mockKnowledge.add).toHaveBeenCalledWith(
        'Important information without metadata',
        undefined
      );

      expect(result).toMatchObject({
        success: true,
        message: 'Content added to knowledge base successfully.',
      });
    });
  });

  describe('knowledge_add and knowledge_search integration', () => {
    it('should add content and then find it via search', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: mockKnowledge,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const knowledgeAddTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');
      const knowledgeSearchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      
      expect(knowledgeAddTool).toBeDefined();
      expect(knowledgeSearchTool).toBeDefined();

      // Add content
      await knowledgeAddTool!.execute({
        content: 'The API rate limit is 100 requests per minute',
        metadata: { source: 'documentation' },
      });

      await knowledgeAddTool!.execute({
        content: 'Authentication requires an API key in the header',
        metadata: { source: 'documentation' },
      });

      await knowledgeAddTool!.execute({
        content: 'The database supports PostgreSQL and MySQL',
        metadata: { source: 'technical-specs' },
      });

      // Search for added content
      const searchResults = await knowledgeSearchTool!.execute({
        query: 'API',
        limit: 10,
      });

      // Verify search finds the added content
      expect(searchResults).toHaveLength(2);
      expect(searchResults[0].content).toContain('rate limit');
      expect(searchResults[1].content).toContain('Authentication');
      expect(searchResults[0].metadata).toEqual({ source: 'documentation' });
    });

    it('should handle multiple add operations and search correctly', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: mockKnowledge,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const knowledgeAddTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');
      const knowledgeSearchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');

      // Add multiple pieces of information
      const topics = [
        'Python is a high-level programming language',
        'JavaScript runs in the browser and on Node.js',
        'TypeScript adds static typing to JavaScript',
        'Rust is a systems programming language',
      ];

      for (const topic of topics) {
        await knowledgeAddTool!.execute({ content: topic });
      }

      // Search for JavaScript-related content
      const jsResults = await knowledgeSearchTool!.execute({
        query: 'JavaScript',
        limit: 5,
      });

      expect(jsResults).toHaveLength(2);
      expect(jsResults.some((r: any) => r.content.includes('browser'))).toBe(true);
      expect(jsResults.some((r: any) => r.content.includes('TypeScript'))).toBe(true);

      // Search for programming languages
      const langResults = await knowledgeSearchTool!.execute({
        query: 'programming language',
        limit: 5,
      });

      // At least Python and Rust should match
      expect(langResults.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty results when search finds nothing', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: mockKnowledge,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const knowledgeSearchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');

      // Search without adding any content
      const results = await knowledgeSearchTool!.execute({
        query: 'nonexistent content',
        limit: 5,
      });

      expect(results).toHaveLength(0);
    });
  });

  describe('knowledge tools not present when knowledge is not configured', () => {
    it('should not include knowledge tools when knowledge is not provided', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        // No knowledge configured
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      // Should have no request tools
      expect(request.requestTools).toBeUndefined();
    });

    it('should not include knowledge tools when knowledge is null', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: null,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      expect(request.requestTools).toBeUndefined();
    });

    it('should not include knowledge tools when knowledge is empty array', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      expect(request.requestTools).toBeUndefined();
    });
  });

  describe('multiple knowledge layers (array)', () => {
    let primaryKB: KnowledgeInstance;
    let secondaryKB: KnowledgeInstance;

    beforeEach(() => {
      // Primary KB returns high scores
      primaryKB = {
        toTool: vi.fn().mockReturnValue({
          name: 'knowledge_search',
          displayName: 'Knowledge Search',
          description: 'Primary knowledge',
          category: 'search',
          parameters: { type: 'object', properties: {}, required: [] },
          execute: vi.fn().mockImplementation(async () => [
            { id: 'p1', content: 'primary result A', score: 0.95, metadata: { source: 'primary' } },
            { id: 'p2', content: 'primary result B', score: 0.85, metadata: { source: 'primary' } },
          ]),
        }),
        add: vi.fn().mockResolvedValue('primary-chunk-id'),
        query: vi.fn().mockResolvedValue([]),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      // Secondary KB returns lower scores
      secondaryKB = {
        toTool: vi.fn().mockReturnValue({
          name: 'knowledge_search',
          displayName: 'Knowledge Search',
          description: 'Secondary knowledge',
          category: 'search',
          parameters: { type: 'object', properties: {}, required: [] },
          execute: vi.fn().mockImplementation(async () => [
            { id: 's1', content: 'secondary result C', score: 0.90, metadata: { source: 'secondary' } },
            { id: 's2', content: 'secondary result D', score: 0.80, metadata: { source: 'secondary' } },
          ]),
        }),
        add: vi.fn().mockResolvedValue('secondary-chunk-id'),
        query: vi.fn().mockResolvedValue([]),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('should merge and sort results from multiple layers by score', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, secondaryKB],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      expect(searchTool).toBeDefined();

      const results = await searchTool!.execute({ query: 'test' });

      // Should be sorted by score descending
      expect(results[0].score).toBe(0.95);
      expect(results[1].score).toBe(0.90);
      expect(results[2].score).toBe(0.85);
      expect(results[3].score).toBe(0.80);
    });

    it('should tag each result with _layer index', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, secondaryKB],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      const results = await searchTool!.execute({ query: 'test' });

      // primaryKB results should have _layer: 0, secondaryKB _layer: 1
      expect(results[0]._layer).toBe(0); // 0.95 from primary
      expect(results[1]._layer).toBe(1); // 0.90 from secondary
      expect(results[2]._layer).toBe(0); // 0.85 from primary
      expect(results[3]._layer).toBe(1); // 0.80 from secondary
    });

    it('should respect limit across merged results', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, secondaryKB],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      const results = await searchTool!.execute({ query: 'test', limit: 2 });

      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.95);
      expect(results[1].score).toBe(0.90);
    });

    it('should default limit to 10 when not specified', async () => {
      primaryKB.toTool = vi.fn().mockReturnValue({
        name: 'knowledge_search',
        displayName: 'Knowledge Search',
        description: 'Primary',
        category: 'search',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: vi.fn().mockImplementation(async () =>
          Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, content: 'item', score: 0.9 - i * 0.01 }))
        ),
      });

      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, secondaryKB],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      const results = await searchTool!.execute({ query: 'test' }); // no limit

      // 8 + 4 = 12 possible, capped at 10
      expect(results.length).toBeLessThanOrEqual(10);
    });

    it('should have correct tool description mentioning multiple layers', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, secondaryKB],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      expect(searchTool!.description).toContain('2 knowledge layers');
    });

    it('should add content to the first (primary) layer only', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, secondaryKB],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const addTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');
      expect(addTool).toBeDefined();
      expect(addTool!.description).toContain('primary knowledge base');

      await addTool!.execute({ content: 'new chunk', metadata: { tag: 'test' } });

      expect(primaryKB.add).toHaveBeenCalledWith('new chunk', { tag: 'test' });
      expect(secondaryKB.add).not.toHaveBeenCalled();
    });

    it('should filter out null/undefined entries in array', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, null, secondaryKB, undefined] as any,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      // Should still work with just the valid entries
      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      expect(searchTool).toBeDefined();

      const results = await searchTool!.execute({ query: 'test' });
      // Should merge from 2 valid KBs
      expect(results).toHaveLength(4);
    });

    it('should filter out entries missing toTool method', async () => {
      const invalidKB = { add: vi.fn(), query: vi.fn(), stop: vi.fn() } as any; // no toTool

      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [primaryKB, invalidKB, secondaryKB] as any,
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      const results = await searchTool!.execute({ query: 'test' });

      // Should merge from 2 valid KBs, invalid entry ignored
      expect(results).toHaveLength(4);
    });

    it('should behave identically to single KB when array has one element', async () => {
      const toolpack = await Toolpack.init({
        provider: 'openai',
        apiKey: 'test-key',
        knowledge: [mockKnowledge],
      });

      const request = (toolpack as any).prepareRequest({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
      });

      // Should have same tools as single-KB path
      expect(request.requestTools).toHaveLength(2);

      const searchTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_search');
      const addTool = request.requestTools?.find((t: RequestToolDefinition) => t.name === 'knowledge_add');

      expect(searchTool).toBeDefined();
      expect(addTool).toBeDefined();
    });
  });
});
