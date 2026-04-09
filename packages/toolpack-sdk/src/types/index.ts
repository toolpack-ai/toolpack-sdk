export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
    type: 'text';
    text: string;
}

export interface ImageDataPart {
    type: 'image_data';
    image_data: {
        /** base64-encoded string */
        data: string;
        /** e.g., 'image/png' */
        mimeType: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

export interface ImageFilePart {
    type: 'image_file';
    image_file: {
        /** local file path */
        path: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

export interface ImageUrlPart {
    type: 'image_url';
    image_url: {
        /** HTTP/HTTPS URL */
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

export type ImagePart = ImageDataPart | ImageFilePart | ImageUrlPart;

export type MessageContent = string | (TextPart | ImagePart)[] | null;

export type MediaUploadStrategy = 'inline' | 'upload' | 'auto';

export interface MediaOptions {
    /** How to handle image payloads */
    uploadStrategy?: MediaUploadStrategy;
    /** Max size in bytes before switching from inline to upload if strategy is 'auto' (default: 4MB) */
    maxInlineSize?: number;
}

export interface FileUploadRequest {
    /** Path to file for upload */
    filePath?: string;
    /** Base64 or raw data for upload */
    data?: Buffer | string;
    mimeType: string;
    purpose?: string;
}

export interface FileUploadResponse {
    id: string;
    url?: string;
    expiresAt?: Date;
}

export interface ToolCallMessage {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON-serialized arguments
    };
}

export interface Message {
    role: Role;
    content: MessageContent;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCallMessage[];
}

export interface ToolCallFunction {
    name: string;
    description: string;
    parameters: Record<string, any>;
}

export interface ToolCallRequest {
    type: 'function';
    function: ToolCallFunction;
}

export interface ToolCallResult {
    id: string;
    name: string;
    arguments: Record<string, any>;
    result?: string;
    duration?: number;
}

export interface CompletionRequest {
    messages: Message[];
    model: string;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    response_format?: 'text' | 'json_object';
    stream?: boolean;
    tools?: ToolCallRequest[];
    tool_choice?: 'auto' | 'none' | 'required';
    /** AbortSignal to cancel the request */
    signal?: AbortSignal;
    /** Multimodal media handling options */
    mediaOptions?: MediaOptions;
}

export interface Usage {
    prompt_tokens: number;
    completion_tokens?: number;
    total_tokens: number;
}

export interface CompletionResponse {
    content: string | null;  // null if only tool calls
    usage?: Usage;
    /** Detailed breakdown of token usage when executed in agent/workflow mode */
    usage_details?: {
        planning?: Usage;
        steps?: Array<{ stepNumber: number; description: string; usage: Usage }>;
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
    tool_calls?: ToolCallResult[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw?: any;
}

export interface CompletionChunk {
    delta: string;
    usage?: Usage;
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
    tool_calls?: ToolCallResult[];
    /** Present when chunk comes from a workflow step */
    workflowStep?: { number: number; description: string };
}

export interface EmbeddingRequest {
    input: string | string[];
    model: string;
}

export interface EmbeddingResponse {
    embeddings: number[][]; // Array of vectors
    usage?: Usage;
}

export interface ProviderConfig {
    apiKey: string;
    baseURL?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
}

export interface CompletionOptions extends CompletionRequest {
    provider?: string;
}

export interface ToolProgressEvent {
    toolName: string;
    toolCallId: string;
    status: 'started' | 'completed' | 'failed';
    args?: Record<string, any>;
    result?: string;
    error?: string;
    duration?: number;
}

/**
 * Event emitted after each tool execution with full details for logging/history.
 * Unlike ToolProgressEvent which truncates results, this contains the complete data.
 */
export interface ToolLogEvent {
    id: string;
    name: string;
    arguments: Record<string, any>;
    result: string;
    duration: number;
    status: 'success' | 'error';
    timestamp: number;
}

// ── Human-in-the-Loop (HITL) Types ────────────────────────────

import type { ConfirmationLevel, ToolDefinition } from '../tools/types.js';

export type ConfirmationDecision =
    | { action: 'allow' }
    | { action: 'deny'; reason?: string }
    | { action: 'modify'; args: Record<string, any> };

export interface ToolConfirmationRequestedEvent {
    tool: ToolDefinition;
    args: Record<string, any>;
    level: ConfirmationLevel;
    reason: string;
}

export interface ToolConfirmationResolvedEvent extends ToolConfirmationRequestedEvent {
    decision: ConfirmationDecision;
}

/**
 * Callback type for handling tool confirmation requests.
 * Called before executing tools that have confirmation metadata set.
 */
export type OnToolConfirmCallback = (
    tool: ToolDefinition,
    args: Record<string, any>,
    context: { roundNumber: number; conversationId?: string }
) => Promise<ConfirmationDecision>;

/**
 * Information about a single model available from a provider.
 */
export interface ProviderModelInfo {
    /** Model identifier used in API calls (e.g., "gpt-4.1", "claude-sonnet-4-20250514") */
    id: string;

    /** Human-readable display name (e.g., "GPT-4.1", "Claude Sonnet 4") */
    displayName: string;

    /** Model capabilities */
    capabilities: {
        /** Supports chat completions */
        chat: boolean;
        /** Supports streaming responses */
        streaming: boolean;
        /** Supports function/tool calling */
        toolCalling: boolean;
        /** Supports embedding generation */
        embeddings: boolean;
        /** Supports image/vision input */
        vision: boolean;
        /** Supports reasoning/thinking capabilities */
        reasoning?: boolean;
        /** Supports file upload API directly */
        fileUpload?: boolean;
    };

    /** Context window size in tokens (if known) */
    contextWindow?: number;

    /** Maximum output tokens (if known) */
    maxOutputTokens?: number;

    /** Input modalities supported by the model (e.g., 'text', 'image', 'audio') */
    inputModalities?: string[];

    /** Output modalities supported by the model (e.g., 'text', 'image', 'audio') */
    outputModalities?: string[];

    /** Reasoning tier for models with thinking capabilities (e.g., 'standard', 'extended') */
    reasoningTier?: string | null;

    /** Cost tier indicator (e.g., 'low', 'medium', 'high', 'premium') */
    costTier?: string;
}

/**
 * Information about a registered provider and its available models.
 */
export interface ProviderInfo {
    /** Provider name as registered (e.g., "openai", "grok") */
    name: string;

    /** Human-readable display name (e.g., "OpenAI", "Grok by xAI") */
    displayName: string;

    /** Whether this is a built-in or custom provider */
    type: 'built-in' | 'custom';

    /** Available models from this provider */
    models: ProviderModelInfo[];
}
