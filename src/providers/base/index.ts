import { CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse, ProviderModelInfo, FileUploadRequest, FileUploadResponse } from '../../types';
export { CompletionRequest, CompletionResponse, CompletionChunk, EmbeddingRequest, EmbeddingResponse, ProviderModelInfo, FileUploadRequest, FileUploadResponse } from '../../types';
import { InvalidRequestError } from '../../errors';

export abstract class ProviderAdapter {
    /**
     * Provider name used for registration and routing.
     * Custom adapters should set this in their constructor.
     */
    name?: string;

    /**
     * Generates a text completion for the given request.
     */
    abstract generate(request: CompletionRequest): Promise<CompletionResponse>;

    /**
     * Streams text completion chunks for the given request.
     */
    abstract stream(request: CompletionRequest): AsyncGenerator<CompletionChunk>;

    /**
     * Generates embeddings for the given input.
     */
    abstract embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;

    /**
     * Optional: Provide image generation if supported.
     * Defined as any for now to avoid circular deps or complex types in base.
     */
    // abstract generateImage(request: any): Promise<any>;

    /**
     * Returns the list of models available from this provider.
     * Override to provide a curated list or fetch from the provider's API.
     *
     * Default: returns an empty array.
     */
    async getModels(): Promise<ProviderModelInfo[]> {
        return [];
    }

    /**
     * Returns a human-readable display name for this provider.
     * Override to customize.
     *
     * Default: uses `this.name` if set, otherwise derives from class name.
     */
    getDisplayName(): string {
        return this.name || this.constructor.name.replace(/Adapter$/, '');
    }

    /**
     * Check if this provider supports the file upload API natively.
     */
    supportsFileUpload(): boolean {
        return false;
    }

    /**
     * Upload a file to the provider (if supported).
     * @throws InvalidRequestError if not supported by this provider.
     */
    async uploadFile(_request: FileUploadRequest): Promise<FileUploadResponse> {
        throw new InvalidRequestError(`File upload API is not supported by ${this.getDisplayName()}`);
    }

    /**
     * Delete an uploaded file (if supported).
     * @throws InvalidRequestError if not supported by this provider.
     */
    async deleteFile(_fileId: string): Promise<void> {
        throw new InvalidRequestError(`File deletion API is not supported by ${this.getDisplayName()}`);
    }
}
