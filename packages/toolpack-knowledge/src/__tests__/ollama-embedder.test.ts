import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaEmbedder } from '../embedders/ollama.js';
import { EmbeddingError } from '../errors.js';

describe('OllamaEmbedder', () => {
  let fetchMock: any;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should set dimensions from known models', () => {
      const embedder1 = new OllamaEmbedder({ model: 'nomic-embed-text' });
      expect(embedder1.dimensions).toBe(768);

      const embedder2 = new OllamaEmbedder({ model: 'mxbai-embed-large' });
      expect(embedder2.dimensions).toBe(1024);

      const embedder3 = new OllamaEmbedder({ model: 'all-minilm' });
      expect(embedder3.dimensions).toBe(384);
    });

    it('should throw for unknown models without dimensions override', () => {
      expect(() => new OllamaEmbedder({ model: 'unknown-model' })).toThrow('Unknown Ollama model');
    });

    it('should accept custom dimensions for unknown models', () => {
      const embedder = new OllamaEmbedder({ model: 'custom-model', dimensions: 512 });
      expect(embedder.dimensions).toBe(512);
    });

    it('should allow dimensions override for known models', () => {
      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text', dimensions: 256 });
      expect(embedder.dimensions).toBe(256);
    });

    it('should use default baseUrl', () => {
      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });
      expect(embedder).toBeDefined();
    });

    it('should accept custom baseUrl', () => {
      const embedder = new OllamaEmbedder({
        model: 'nomic-embed-text',
        baseUrl: 'http://custom:11434',
      });
      expect(embedder).toBeDefined();
    });
  });

  describe('embed', () => {
    it('should successfully embed text', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: mockEmbedding }),
      });

      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });
      const result = await embedder.embed('test text');

      expect(result).toEqual(mockEmbedding);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:11434/api/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'test text' }),
        })
      );
    });

    it('should use custom baseUrl', async () => {
      const mockEmbedding = [0.1, 0.2];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: mockEmbedding }),
      });

      const embedder = new OllamaEmbedder({
        model: 'nomic-embed-text',
        baseUrl: 'http://custom:8080',
      });
      await embedder.embed('test');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://custom:8080/api/embeddings',
        expect.any(Object)
      );
    });

    it('should throw EmbeddingError on HTTP error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });
      
      await expect(embedder.embed('test')).rejects.toThrow(EmbeddingError);
      await expect(embedder.embed('test')).rejects.toThrow('Ollama embedding failed');
    });

    it('should retry on transient failures', async () => {
      const mockEmbedding = [0.1, 0.2];
      
      fetchMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: mockEmbedding }),
        });

      const embedder = new OllamaEmbedder({
        model: 'nomic-embed-text',
        retries: 3,
        retryDelay: 10,
      });

      const result = await embedder.embed('test');
      expect(result).toEqual(mockEmbedding);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should not retry on 4xx client errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const embedder = new OllamaEmbedder({
        model: 'nomic-embed-text',
        retries: 3,
        retryDelay: 10,
      });

      await expect(embedder.embed('test')).rejects.toThrow(EmbeddingError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const embedder = new OllamaEmbedder({
        model: 'nomic-embed-text',
        retries: 3,
        retryDelay: 10,
      });

      await expect(embedder.embed('test')).rejects.toThrow('Ollama embedding failed after 3 retries');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should use default retry settings', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });

      await expect(embedder.embed('test')).rejects.toThrow('Ollama embedding failed after 3 retries');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('embedBatch', () => {
    it('should embed multiple texts', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: mockEmbeddings[0] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: mockEmbeddings[1] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: mockEmbeddings[2] }),
        });

      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });
      const results = await embedder.embedBatch(['text1', 'text2', 'text3']);

      expect(results).toEqual(mockEmbeddings);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should handle empty array', async () => {
      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });
      const results = await embedder.embedBatch([]);

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should propagate errors from individual embeds', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const embedder = new OllamaEmbedder({
        model: 'nomic-embed-text',
        retries: 1,
        retryDelay: 10,
      });

      await expect(embedder.embedBatch(['text1', 'text2'])).rejects.toThrow();
    });
  });
});
