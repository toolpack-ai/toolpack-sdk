import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaEmbedder } from '../../../src/knowledge/embedders/ollama-embedder.js';
import { OpenAIEmbedder } from '../../../src/knowledge/embedders/openai-embedder.js';

describe('OllamaEmbedder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('embed', () => {
    it('should return embedding vector from Ollama API', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: mockEmbedding }),
      });

      const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });
      const result = await embedder.embed('test text');

      expect(result).toEqual(mockEmbedding);
      expect(embedder.dimensions).toBe(5);
    });

    it('should throw EmbeddingError on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      const embedder = new OllamaEmbedder();
      await expect(embedder.embed('test')).rejects.toThrow('Ollama embedding failed');
    });

    it('should throw EmbeddingError on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const embedder = new OllamaEmbedder();
      await expect(embedder.embed('test')).rejects.toThrow('Failed to get embedding from Ollama');
    });
  });

  describe('embedBatch', () => {
    it('should embed multiple texts', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: mockEmbedding }),
      });

      const embedder = new OllamaEmbedder();
      const results = await embedder.embedBatch(['text1', 'text2']);

      expect(results).toHaveLength(2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('isAvailable', () => {
    it('should return true when Ollama is running', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const embedder = new OllamaEmbedder();
      const available = await embedder.isAvailable();

      expect(available).toBe(true);
    });

    it('should return false when Ollama is not running', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const embedder = new OllamaEmbedder();
      const available = await embedder.isAvailable();

      expect(available).toBe(false);
    });
  });
});

describe('OpenAIEmbedder', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should throw if no API key provided', () => {
      process.env = { ...originalEnv };
      delete process.env.OPENAI_API_KEY;
      delete process.env.TOOLPACK_OPENAI_KEY;

      expect(() => new OpenAIEmbedder()).toThrow('OpenAI API key is required');
    });

    it('should use provided API key', () => {
      process.env = { ...originalEnv };
      delete process.env.OPENAI_API_KEY;
      delete process.env.TOOLPACK_OPENAI_KEY;

      const embedder = new OpenAIEmbedder({ apiKey: 'custom-key' });
      expect(embedder).toBeDefined();
    });
  });

  describe('dimensions', () => {
    it('should return correct dimensions for text-embedding-3-small', () => {
      const embedder = new OpenAIEmbedder({ model: 'text-embedding-3-small' });
      expect(embedder.dimensions).toBe(1536);
    });

    it('should return correct dimensions for text-embedding-3-large', () => {
      const embedder = new OpenAIEmbedder({ model: 'text-embedding-3-large' });
      expect(embedder.dimensions).toBe(3072);
    });
  });

  describe('embedBatch', () => {
    it('should return embeddings from OpenAI API', async () => {
      const mockResponse = {
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const embedder = new OpenAIEmbedder();
      const results = await embedder.embedBatch(['text1', 'text2']);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([0.1, 0.2, 0.3]);
      expect(results[1]).toEqual([0.4, 0.5, 0.6]);
    });

    it('should sort results by index', async () => {
      const mockResponse = {
        data: [
          { index: 1, embedding: [0.4, 0.5, 0.6] },
          { index: 0, embedding: [0.1, 0.2, 0.3] },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const embedder = new OpenAIEmbedder();
      const results = await embedder.embedBatch(['text1', 'text2']);

      expect(results[0]).toEqual([0.1, 0.2, 0.3]);
      expect(results[1]).toEqual([0.4, 0.5, 0.6]);
    });

    it('should retry on rate limit', async () => {
      let callCount = 0;
      
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [{ index: 0, embedding: [0.1, 0.2] }],
          }),
        });
      });

      const embedder = new OpenAIEmbedder({ retryDelay: 10 });
      const results = await embedder.embedBatch(['text']);

      expect(results).toHaveLength(1);
      expect(callCount).toBe(2);
    });

    it('should throw after max retries', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
      });

      const embedder = new OpenAIEmbedder({ retries: 2, retryDelay: 10 });
      
      await expect(embedder.embedBatch(['text'])).rejects.toThrow('Rate limited');
    });
  });

  describe('embed', () => {
    it('should embed single text', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
      });

      const embedder = new OpenAIEmbedder();
      const result = await embedder.embed('test');

      expect(result).toEqual([0.1, 0.2, 0.3]);
    });
  });
});
