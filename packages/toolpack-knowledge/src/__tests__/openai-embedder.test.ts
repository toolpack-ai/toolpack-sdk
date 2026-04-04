import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIEmbedder } from '../embedders/openai.js';
import { EmbeddingError } from '../errors.js';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      embeddings = { create: mockCreate };
      constructor(_opts: any) {}
    },
  };
});

describe('OpenAIEmbedder', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('constructor', () => {
    it('should set dimensions from known models', () => {
      const embedder1 = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      });
      expect(embedder1.dimensions).toBe(1536);

      const embedder2 = new OpenAIEmbedder({
        model: 'text-embedding-3-large',
        apiKey: 'test-key',
      });
      expect(embedder2.dimensions).toBe(3072);

      const embedder3 = new OpenAIEmbedder({
        model: 'text-embedding-ada-002',
        apiKey: 'test-key',
      });
      expect(embedder3.dimensions).toBe(1536);
    });

    it('should default to 1536 dimensions for unknown models', () => {
      const embedder = new OpenAIEmbedder({
        model: 'unknown-model',
        apiKey: 'test-key',
      });
      expect(embedder.dimensions).toBe(1536);
    });

    it('should accept custom timeout', () => {
      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        timeout: 60000,
      });
      expect(embedder).toBeDefined();
    });
  });

  describe('embed', () => {
    it('should successfully embed text', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      });

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
      });
    });

    it('should retry on failures', async () => {
      const mockEmbedding = [0.1, 0.2];
      
      mockCreate
        .mockRejectedValueOnce(new Error('Rate limit'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          data: [{ embedding: mockEmbedding }],
        });

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        retries: 3,
        retryDelay: 10,
      });

      const result = await embedder.embed('test');
      expect(result).toEqual(mockEmbedding);
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        retries: 3,
        retryDelay: 10,
      });

      const err = await embedder.embed('test').catch(e => e);
      expect(err).toBeInstanceOf(EmbeddingError);
      expect(err.message).toContain('OpenAI embedding failed after 3 retries');
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('should use default retry settings', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      });

      await expect(embedder.embed('test')).rejects.toThrow('OpenAI embedding failed after 3 retries');
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('should respect custom retry delay', async () => {
      const mockEmbedding = [0.1, 0.2];
      const startTime = Date.now();
      
      mockCreate
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockResolvedValueOnce({
          data: [{ embedding: mockEmbedding }],
        });

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        retries: 2,
        retryDelay: 50,
      });

      await embedder.embed('test');
      const elapsed = Date.now() - startTime;
      
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some margin
    });
  });

  describe('embedBatch', () => {
    it('should embed multiple texts in one call', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];

      mockCreate.mockResolvedValueOnce({
        data: mockEmbeddings.map(embedding => ({ embedding })),
      });

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      });

      const results = await embedder.embedBatch(['text1', 'text2', 'text3']);

      expect(results).toEqual(mockEmbeddings);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['text1', 'text2', 'text3'],
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should handle empty array', async () => {
      mockCreate.mockResolvedValueOnce({
        data: [],
      });

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      });

      const results = await embedder.embedBatch([]);

      expect(results).toEqual([]);
    });

    it('should retry on batch failures', async () => {
      const mockEmbeddings = [[0.1, 0.2], [0.3, 0.4]];

      mockCreate
        .mockRejectedValueOnce(new Error('Rate limit'))
        .mockResolvedValueOnce({
          data: mockEmbeddings.map(embedding => ({ embedding })),
        });

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        retries: 3,
        retryDelay: 10,
      });

      const results = await embedder.embedBatch(['text1', 'text2']);

      expect(results).toEqual(mockEmbeddings);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should throw EmbeddingError after max retries', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        retries: 2,
        retryDelay: 10,
      });

      await expect(embedder.embedBatch(['text1', 'text2'])).rejects.toThrow(EmbeddingError);
      await expect(embedder.embedBatch(['text1', 'text2'])).rejects.toThrow('OpenAI batch embedding failed after 2 retries');
    });

    it('should preserve embedding order', async () => {
      const mockEmbeddings = [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ];

      mockCreate.mockResolvedValueOnce({
        data: mockEmbeddings.map(embedding => ({ embedding })),
      });

      const embedder = new OpenAIEmbedder({
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      });

      const results = await embedder.embedBatch(['a', 'b', 'c']);

      expect(results[0]).toEqual(mockEmbeddings[0]);
      expect(results[1]).toEqual(mockEmbeddings[1]);
      expect(results[2]).toEqual(mockEmbeddings[2]);
    });
  });
});
