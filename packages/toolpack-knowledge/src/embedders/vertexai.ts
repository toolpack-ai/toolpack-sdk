import { Embedder } from '../interfaces.js';
import { EmbeddingError } from '../errors.js';

export interface VertexAIEmbedderOptions {
  /** GCP project ID. Falls back to VERTEX_AI_PROJECT / GOOGLE_CLOUD_PROJECT env vars. */
  projectId?: string;
  /** GCP region. Defaults to 'us-central1'. */
  location?: string;
  /**
   * Embedding model. Defaults to 'gemini-embedding-2' (3072 dims).
   * Other options: 'gemini-embedding-001' (3072), 'text-embedding-005' (768).
   */
  model?: string;
  /**
   * Output dimensionality override.
   * Must match what the knowledge store was initialised with — changing this requires wiping the store.
   */
  outputDimensionality?: number;
  /** Max retries on transient errors. Default: 3. */
  retries?: number;
  /** Delay between retries in ms. Default: 1000. For RESOURCE_EXHAUSTED/quota errors, set to 60000+. */
  retryDelay?: number;
  /**
   * Milliseconds to wait between consecutive embedBatch calls.
   * Use this to stay under the Vertex AI embedding QPM quota when syncing large knowledge bases.
   * Example: 500 adds a 0.5s pause between batches (120 QPM effective rate).
   */
  rateLimitMs?: number;
}

const MODEL_DIMENSIONS: Record<string, number> = {
  'gemini-embedding-001': 3072,
  'text-embedding-005': 768,
  'text-multilingual-embedding-002': 768,
};

export class VertexAIEmbedder implements Embedder {
  readonly dimensions: number;
  private readonly projectId: string;
  private readonly location: string;
  private readonly model: string;
  private readonly outputDimensionality: number;
  private readonly retries: number;
  private readonly retryDelay: number;
  private readonly rateLimitMs: number;
  private lastEmbedAt = 0;

  constructor(options: VertexAIEmbedderOptions = {}) {
    this.model = options.model ?? 'gemini-embedding-001';
    this.location =
      options.location ??
      process.env.VERTEX_AI_LOCATION ??
      process.env.TOOLPACK_VERTEXAI_LOCATION ??
      'us-central1';

    const projectId =
      options.projectId ??
      process.env.VERTEX_AI_PROJECT ??
      process.env.TOOLPACK_VERTEXAI_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT;

    if (!projectId) {
      throw new EmbeddingError(
        'VertexAIEmbedder requires a GCP project ID. ' +
        'Pass projectId in options or set VERTEX_AI_PROJECT / GOOGLE_CLOUD_PROJECT.',
      );
    }

    this.projectId = projectId;
    this.dimensions = options.outputDimensionality ?? MODEL_DIMENSIONS[this.model] ?? 3072;
    this.outputDimensionality = this.dimensions;
    this.retries = options.retries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
    this.rateLimitMs = options.rateLimitMs ?? 0;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this.rateLimitMs > 0) {
      const elapsed = Date.now() - this.lastEmbedAt;
      if (elapsed < this.rateLimitMs) {
        await new Promise(resolve => setTimeout(resolve, this.rateLimitMs - elapsed));
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const result = await this._request(texts);
        this.lastEmbedAt = Date.now();
        return result;
      } catch (error) {
        lastError = error as Error;
        console.error(`[${new Date().toISOString()}] [ERROR] [VertexAI Embedder] attempt ${attempt + 1}/${this.retries} failed: ${lastError.message}`);
        if (attempt < this.retries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    throw new EmbeddingError(
      `VertexAI embedding failed after ${this.retries} retries: ${lastError?.message}`,
    );
  }

  private async _request(texts: string[]): Promise<number[][]> {
    const ts = () => new Date().toISOString();
    console.debug(`[${ts()}] [DEBUG] [VertexAI Embedder] embed texts=${texts.length} model=${this.model}`);
    const token = await this._getAccessToken();
    const url =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}` +
      `/locations/${this.location}/publishers/google/models/${this.model}:predict`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: texts.map(content => ({ content, taskType: 'RETRIEVAL_DOCUMENT' })),
        parameters: { outputDimensionality: this.outputDimensionality },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EmbeddingError(`VertexAI embeddings API error ${response.status}: ${text}`);
    }

    const data = await response.json() as { predictions: Array<{ embeddings: { values: number[] } }> };
    const dims = data.predictions[0]?.embeddings?.values?.length ?? 0;
    console.debug(`[${ts()}] [DEBUG] [VertexAI Embedder] embed complete dims=${dims}`);
    return data.predictions.map(p => p.embeddings.values);
  }

  private async _getAccessToken(): Promise<string> {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new EmbeddingError('Failed to obtain Google access token via ADC.');
    return token.token;
  }
}
