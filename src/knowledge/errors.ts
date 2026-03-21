export class KnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

export class EmbeddingError extends KnowledgeError {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export class IngestionError extends KnowledgeError {
  constructor(
    message: string,
    public readonly file?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

export class ChunkTooLargeError extends KnowledgeError {
  constructor(
    message: string,
    public readonly chunkSize: number,
    public readonly maxSize: number
  ) {
    super(message);
    this.name = 'ChunkTooLargeError';
  }
}

export class ProviderError extends KnowledgeError {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
