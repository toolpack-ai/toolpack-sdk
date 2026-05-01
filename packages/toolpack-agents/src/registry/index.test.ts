import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchRegistry, RegistryError } from './search.js';

describe('registry', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('searchRegistry', () => {
    it('should search for toolpack-agent packages', async () => {
      const mockResponse = {
        objects: [
          {
            package: {
              name: 'toolpack-agent-research',
              version: '1.0.0',
              description: 'A research agent',
              keywords: ['toolpack-agent', 'research'],
              date: '2024-01-01',
              toolpack: {
                agent: true,
                category: 'research',
                description: 'Research agent for web data',
                tags: ['web', 'research'],
              },
              links: {
                npm: 'https://www.npmjs.com/package/toolpack-agent-research',
              },
            },
            score: { final: 0.9 },
          },
          {
            package: {
              name: 'toolpack-agent-coding',
              version: '2.0.0',
              description: 'A coding agent',
              keywords: ['toolpack-agent', 'coding'],
              date: '2024-01-02',
              toolpack: {
                agent: true,
                category: 'coding',
                description: 'Coding assistant agent',
              },
              links: {
                npm: 'https://www.npmjs.com/package/toolpack-agent-coding',
              },
            },
            score: { final: 0.8 },
          },
        ],
        total: 2,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await searchRegistry();

      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].name).toBe('toolpack-agent-research');
      expect(result.agents[0].toolpack?.category).toBe('research');
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by keyword', async () => {
      const mockResponse = {
        objects: [
          {
            package: {
              name: 'toolpack-agent-finance',
              version: '1.0.0',
              description: 'Finance agent',
              keywords: ['toolpack-agent', 'finance'],
              toolpack: {
                agent: true,
                category: 'research',
                tags: ['finance'],
              },
            },
          },
        ],
        total: 1,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await searchRegistry({ keyword: 'finance' });

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('text=toolpack-agent+finance'),
        expect.any(Object)
      );
      expect(result.agents).toHaveLength(1);
    });

    it('should filter by category', async () => {
      const mockResponse = {
        objects: [
          {
            package: {
              name: 'agent-1',
              version: '1.0.0',
              toolpack: { agent: true, category: 'research' },
            },
          },
          {
            package: {
              name: 'agent-2',
              version: '1.0.0',
              toolpack: { agent: true, category: 'coding' },
            },
          },
          {
            package: {
              name: 'agent-3',
              version: '1.0.0',
              toolpack: { agent: true, category: 'research' },
            },
          },
        ],
        total: 3,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await searchRegistry({ category: 'research' });

      expect(result.agents).toHaveLength(2);
      expect(result.agents.every(a => a.toolpack?.category === 'research')).toBe(true);
    });

    it('should filter by tag', async () => {
      const mockResponse = {
        objects: [
          {
            package: {
              name: 'agent-1',
              version: '1.0.0',
              toolpack: { agent: true, tags: ['ai', 'ml'] },
            },
          },
          {
            package: {
              name: 'agent-2',
              version: '1.0.0',
              toolpack: { agent: true, tags: ['web'] },
            },
          },
          {
            package: {
              name: 'agent-3',
              version: '1.0.0',
              keywords: ['ai'],
              toolpack: { agent: true },
            },
          },
        ],
        total: 3,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await searchRegistry({ tag: 'ai' });

      expect(result.agents).toHaveLength(2);
    });

    it('should only include packages with toolpack.agent = true', async () => {
      const mockResponse = {
        objects: [
          {
            package: {
              name: 'valid-agent',
              version: '1.0.0',
              toolpack: { agent: true, category: 'research' },
            },
          },
          {
            package: {
              name: 'invalid-agent',
              version: '1.0.0',
              keywords: ['toolpack-agent'],
              // Missing toolpack.agent = true
            },
          },
          {
            package: {
              name: 'another-valid',
              version: '1.0.0',
              toolpack: { agent: true, category: 'coding' },
            },
          },
        ],
        total: 3,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await searchRegistry();

      expect(result.agents).toHaveLength(2);
      expect(result.agents.map(a => a.name)).toContain('valid-agent');
      expect(result.agents.map(a => a.name)).toContain('another-valid');
      expect(result.agents.map(a => a.name)).not.toContain('invalid-agent');
    });

    it('should handle pagination', async () => {
      const mockResponse = {
        objects: Array.from({ length: 30 }, (_, i) => ({
          package: {
            name: `agent-${i}`,
            version: '1.0.0',
            toolpack: { agent: true },
          },
        })),
        total: 30,
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result1 = await searchRegistry({ limit: 10, offset: 0 });
      expect(result1.agents).toHaveLength(10);
      expect(result1.hasMore).toBe(true);
      expect(result1.agents[0].name).toBe('agent-0');

      const result2 = await searchRegistry({ limit: 10, offset: 10 });
      expect(result2.agents).toHaveLength(10);
      expect(result2.hasMore).toBe(true);
      expect(result2.agents[0].name).toBe('agent-10');

      const result3 = await searchRegistry({ limit: 10, offset: 20 });
      expect(result3.agents).toHaveLength(10);
      expect(result3.hasMore).toBe(false);
      expect(result3.agents[0].name).toBe('agent-20');
    });

    it('should use custom registry URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ objects: [], total: 0 }),
      } as Response);

      await searchRegistry({ registryUrl: 'https://private.registry.com' });

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('https://private.registry.com'),
        expect.any(Object)
      );
    });

    it('should throw RegistryError on HTTP error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      } as Response);

      await expect(searchRegistry()).rejects.toThrow(RegistryError);
      await expect(searchRegistry()).rejects.toThrow('NPM registry search failed');
    });

    it('should throw RegistryError on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      await expect(searchRegistry()).rejects.toThrow(RegistryError);
      await expect(searchRegistry()).rejects.toThrow('Failed to search registry');
    });

    it('should extract all toolpack metadata fields', async () => {
      const mockResponse = {
        objects: [
          {
            package: {
              name: 'complete-agent',
              version: '1.2.3',
              description: 'Full featured agent',
              keywords: ['toolpack-agent'],
              author: 'John Doe',
              date: '2024-01-15',
              links: {
                npm: 'https://npm.example.com/complete-agent',
                homepage: 'https://example.com',
                repository: 'https://github.com/example/agent',
                bugs: 'https://github.com/example/agent/issues',
              },
              publisher: { username: 'johndoe', email: 'john@example.com' },
              maintainers: [{ username: 'johndoe', email: 'john@example.com' }],
              toolpack: {
                agent: true,
                category: 'research',
                description: 'Detailed agent description',
                tags: ['ai', 'ml', 'nlp'],
                author: 'Toolpack Team',
                repository: 'https://github.com/toolpack/complete-agent',
                homepage: 'https://toolpack.dev/complete-agent',
              },
            },
          },
        ],
        total: 1,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await searchRegistry();
      const agent = result.agents[0];

      expect(agent.name).toBe('complete-agent');
      expect(agent.version).toBe('1.2.3');
      expect(agent.description).toBe('Full featured agent');
      expect(agent.toolpack?.agent).toBe(true);
      expect(agent.toolpack?.category).toBe('research');
      expect(agent.toolpack?.description).toBe('Detailed agent description');
      expect(agent.toolpack?.tags).toEqual(['ai', 'ml', 'nlp']);
      expect(agent.toolpack?.author).toBe('Toolpack Team');
      expect(agent.toolpack?.repository).toBe('https://github.com/toolpack/complete-agent');
      expect(agent.toolpack?.homepage).toBe('https://toolpack.dev/complete-agent');
      expect(agent.author).toBe('John Doe');
      expect(agent.date).toBe('2024-01-15');
      expect(agent.links?.npm).toBe('https://npm.example.com/complete-agent');
      expect(agent.publisher?.username).toBe('johndoe');
      expect(agent.maintainers).toHaveLength(1);
    });
  });
});
