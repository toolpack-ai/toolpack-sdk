import { describe, it, expect, vi } from 'vitest';
import { ApiDataSource } from '../../dist/index.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('ApiDataSource', () => {
  it('should fetch and chunk API data', async () => {
    const mockData = {
      data: [
        {
          id: 1,
          title: 'First Item',
          content: 'This is the content of the first item.',
          author: 'Author 1',
        },
        {
          id: 2,
          title: 'Second Item',
          content: 'This is the content of the second item.',
          author: 'Author 2',
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const source = new ApiDataSource('https://api.example.com/data', {
      dataPath: 'data',
      contentExtractor: (item: any) => `${item.title}\n\n${item.content}`,
    });

    const chunks = [];
    for await (const chunk of source.load()) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toContain('First Item');
    expect(chunks[0].content).toContain('content of the first item');
    expect(chunks[0].metadata.id).toBe(1);
    expect(chunks[0].metadata.author).toBe('Author 1');
    expect(chunks[1].metadata.title).toBe('Second Item');
  });

  it('should handle pagination', async () => {
    const mockPage1 = { data: [{ id: 1, content: 'Page 1 content' }] };
    const mockPage2 = { data: [{ id: 2, content: 'Page 2 content' }] };
    const mockPage3 = { data: [] }; // Empty page to stop pagination

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPage1),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPage2),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPage3),
      });

    const source = new ApiDataSource('https://api.example.com/data', {
      dataPath: 'data',
      pagination: {
        param: 'page',
        start: 1,
        step: 1,
        maxPages: 10,
      },
    });

    const chunks = [];
    for await (const chunk of source.load()) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.id).toBe(1);
    expect(chunks[1].metadata.id).toBe(2);
  });
});