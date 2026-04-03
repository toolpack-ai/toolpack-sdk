export class KnowledgeError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

export class EmbeddingError extends KnowledgeError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, 'EMBEDDING_ERROR');
    this.name = 'EmbeddingError';
  }
}

export class IngestionError extends KnowledgeError {
  constructor(message: string, public readonly file?: string) {
    super(message, 'INGESTION_ERROR');
    this.name = 'IngestionError';
  }
}

export class ChunkTooLargeError extends KnowledgeError {
  constructor(message: string, public readonly chunkSize: number) {
    super(message, 'CHUNK_TOO_LARGE');
    this.name = 'ChunkTooLargeError';
  }
}

export class DimensionMismatchError extends KnowledgeError {
  public readonly expected: number;
  public readonly actual: number;

  constructor(expected: number, actual: number) {
    super(
      `Dimension mismatch: expected ${expected}, got ${actual}`,
      'DIMENSION_MISMATCH'
    );
    this.name = 'DimensionMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class KnowledgeProviderError extends KnowledgeError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'KnowledgeProviderError';
  }
}
