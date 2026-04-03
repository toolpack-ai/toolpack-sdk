import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProviderAdapter } from '../base';
import { CompletionRequest, CompletionResponse, CompletionChunk, ToolCallResult, Message, EmbeddingRequest, EmbeddingResponse, ProviderModelInfo, FileUploadRequest, FileUploadResponse } from '../../types';
import { AuthenticationError, RateLimitError, InvalidRequestError, ProviderError } from '../../errors';
import { logDebug, safePreview, logMessagePreview } from '../provider-logger';

export class GeminiAdapter extends ProviderAdapter {
    private genAI: GoogleGenerativeAI;

    constructor(apiKey: string) {
        super();
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    supportsFileUpload(): boolean {
        return true;
    }


    /**
     * Sanitize JSON schema for Gemini API compatibility.
     * Gemini doesn't support: additionalProperties, exclusiveMinimum, exclusiveMaximum, etc.
     */
    private sanitizeSchema(schema: any): any {
        if (!schema || typeof schema !== 'object') {
            return schema;
        }

        const sanitized: any = {};

        for (const [key, value] of Object.entries(schema)) {
            // Skip unsupported properties
            if (key === 'additionalProperties' ||
                key === 'exclusiveMinimum' ||
                key === 'exclusiveMaximum' ||
                key === '$schema' ||
                key === '$id' ||
                key === 'definitions' ||
                key === '$defs') {
                continue;
            }

            // Recursively sanitize nested objects
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    sanitized[key] = value.map(item => this.sanitizeSchema(item));
                } else {
                    sanitized[key] = this.sanitizeSchema(value);
                }
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Upload a file to Gemini's File API.
     * Note: Gemini File API requires using the REST endpoint directly.
     */
    async uploadFile(request: FileUploadRequest): Promise<FileUploadResponse> {
        try {
            const fs = await import('fs');
            const path = await import('path');
            
            if (!request.filePath) {
                throw new InvalidRequestError('Gemini uploadFile requires a filePath.');
            }
            
            // Read file and get metadata
            const fileBuffer = await fs.promises.readFile(request.filePath);
            const fileName = path.basename(request.filePath);
            const mimeType = request.mimeType || 'application/octet-stream';
            
            // Gemini File API endpoint
            const apiKey = (this.genAI as any).apiKey;
            const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
            
            // Create multipart form data manually
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            const metadata = JSON.stringify({ file: { displayName: fileName } });
            
            const body = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`),
                Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
                fileBuffer,
                Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);
            
            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                body,
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini file upload failed: ${response.status} ${errorText}`);
            }
            
            const result = await response.json() as any;
            return {
                id: result.file?.name || result.name,
                url: result.file?.uri || result.uri,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    /**
     * Delete an uploaded file from Gemini's File API.
     */
    async deleteFile(fileId: string): Promise<void> {
        try {
            const apiKey = (this.genAI as any).apiKey;
            const deleteUrl = `https://generativelanguage.googleapis.com/v1beta/${fileId}?key=${apiKey}`;
            
            const response = await fetch(deleteUrl, { method: 'DELETE' });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini file deletion failed: ${response.status} ${errorText}`);
            }
        } catch (error) {
            throw this.handleError(error);
        }
    }

    getDisplayName(): string {
        return 'Google Gemini';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        return [
            {
                id: 'gemini-3.1-flash-lite-preview',
                displayName: 'Gemini 3.1 Flash-Lite Preview',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 1048576,
                maxOutputTokens: 65536,
            },
            {
                id: 'gemini-3-flash-preview',
                displayName: 'Gemini 3 Flash Preview',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 1048576,
                maxOutputTokens: 65536,
            },
            {
                id: 'gemini-3.1-pro-preview',
                displayName: 'Gemini 3.1 Pro Preview',
                capabilities: { chat: true, streaming: true, toolCalling: true, embeddings: false, vision: true, fileUpload: true },
                contextWindow: 1048576,
                maxOutputTokens: 65536,
            },
        ];
    }

    private sanitizeToolName(name: string): string {
        return name.replace(/\./g, '_');
    }

    private restoreToolName(sanitized: string, originalTools?: any[]): string {
        const original = originalTools?.find(t => this.sanitizeToolName(t.function.name) === sanitized);
        return original?.function.name || sanitized.replace(/_/g, '.');
    }

    async generate(request: CompletionRequest): Promise<CompletionResponse> {
        try {
            const requestId = (request as any).__toolpack_request_id || `gen-${Date.now()}`;
            const modelConfig: any = {
                model: request.model,
                systemInstruction: this.extractSystemInstruction(request.messages),
            };

            if (request.tools && request.tools.length > 0) {
                modelConfig.tools = [{
                    functionDeclarations: request.tools.map(t => ({
                        name: this.sanitizeToolName(t.function.name),
                        description: t.function.description,
                        parameters: this.sanitizeSchema(t.function.parameters),
                    })),
                }];
                logDebug(`[Gemini][${requestId}] Sending ${request.tools.length} tools`);
                if (request.tools.length > 0) {
                    logDebug(`[Gemini][${requestId}] First tool: ${safePreview(request.tools[0], 800)}`);
                }
            } else {
                logDebug(`[Gemini][${requestId}] NO TOOLS in request`);
            }

            logDebug(`[Gemini][${requestId}] generate() request: model=${request.model}, messages=${request.messages.length}, tools=${request.tools?.length || 0}`);
            logMessagePreview(requestId, 'Gemini', request.messages);

            const model = this.genAI.getGenerativeModel(modelConfig);

            const { history, lastUserMessage } = await this.formatHistory(request.messages, request.mediaOptions);

            const chat = model.startChat({
                history: history,
                generationConfig: {
                    maxOutputTokens: request.max_tokens,
                    temperature: request.temperature,
                    topP: request.top_p,
                    responseMimeType: request.response_format === 'json_object' ? 'application/json' : 'text/plain',
                },
            });

            const result = await chat.sendMessage(lastUserMessage);
            const response = await result.response;

            // Parse function calls from response
            const toolCalls: ToolCallResult[] = [];
            let textContent = '';

            for (const candidate of response.candidates || []) {
                for (const part of candidate.content?.parts || []) {
                    if ((part as any).text) {
                        textContent += (part as any).text;
                    }
                    if ((part as any).functionCall) {
                        const fc = (part as any).functionCall;
                        toolCalls.push({
                            id: `gemini_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                            name: this.restoreToolName(fc.name, request.tools),
                            arguments: fc.args || {},
                        });
                    }
                }
            }

            logDebug(`[Gemini][${requestId}] Response finish_reason=${toolCalls.length > 0 ? 'tool_calls' : 'stop'} tool_calls=${toolCalls.length} content_preview=${safePreview(textContent, 200)}`);

            return {
                content: textContent || null,
                usage: {
                    prompt_tokens: (response as any).usageMetadata?.promptTokenCount || 0,
                    completion_tokens: (response as any).usageMetadata?.candidatesTokenCount || 0,
                    total_tokens: (response as any).usageMetadata?.totalTokenCount || 0,
                },
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                raw: response,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
        try {
            const modelConfig: any = {
                model: request.model,
                systemInstruction: this.extractSystemInstruction(request.messages),
            };

            if (request.tools && request.tools.length > 0) {
                modelConfig.tools = [{
                    functionDeclarations: request.tools.map(t => ({
                        name: this.sanitizeToolName(t.function.name),
                        description: t.function.description,
                        parameters: this.sanitizeSchema(t.function.parameters),
                    })),
                }];
            }

            const requestId = (request as any).__toolpack_request_id || `str-${Date.now()}`;
            logDebug(`[Gemini][${requestId}] Stream request: model=${request.model}, messages=${request.messages.length}, tools=${request.tools?.length || 0}`);
            if (request.tools && request.tools.length > 0) {
                logDebug(`[Gemini][${requestId}] First tool: ${safePreview(request.tools[0], 800)}`);
            }
            logMessagePreview(requestId, 'Gemini', request.messages);

            const model = this.genAI.getGenerativeModel(modelConfig);

            const { history, lastUserMessage } = await this.formatHistory(request.messages, request.mediaOptions);

            const chat = model.startChat({
                history: history,
                generationConfig: {
                    maxOutputTokens: request.max_tokens,
                    temperature: request.temperature,
                    topP: request.top_p,
                    responseMimeType: request.response_format === 'json_object' ? 'application/json' : 'text/plain',
                },
            });

            const result = await chat.sendMessageStream(lastUserMessage);

            for await (const chunk of result.stream) {
                // Check for function calls in the chunk
                for (const part of (chunk as any).candidates?.[0]?.content?.parts || []) {
                    if (part.functionCall) {
                        logDebug(`[Gemini][${requestId}] Stream finish_reason=tool_calls name=${part.functionCall.name}`);
                        yield {
                            delta: '',
                            finish_reason: 'tool_calls',
                            tool_calls: [{
                                id: `gemini_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                                name: this.restoreToolName(part.functionCall.name, request.tools),
                                arguments: part.functionCall.args || {},
                            }],
                        };
                    } else if (part.text) {
                        yield { delta: part.text };
                    }
                }

                // Fallback: if no parts parsed, try chunk.text()
                try {
                    const text = chunk.text();
                    if (text && !(chunk as any).candidates?.[0]?.content?.parts?.some((p: any) => p.text)) {
                        yield { delta: text };
                    }
                } catch { /* text() may throw if no text parts */ }
            }
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        try {
            const model = this.genAI.getGenerativeModel({ model: request.model });

            // Gemini embedContent takes string or array. If array (batch), use batchEmbedContents?
            // For simplicity, let's assume single string or handle batch loop here.
            // The unified interface says string | string[].

            if (Array.isArray(request.input)) {
                // Very basic batch handling implementation
                // Real implementation should use batchEmbedContents defined on the client usually, 
                // but SDK usage is model.batchEmbedContents? No, define separate method.
                // Let's do simple loop for MVP
                const embeddings = await Promise.all(request.input.map(async (text) => {
                    const result = await model.embedContent(text);
                    return result.embedding.values;
                }));
                return { embeddings };
            } else {
                const result = await model.embedContent(request.input);
                return { embeddings: [result.embedding.values] };
            }
        } catch (error) {
            throw this.handleError(error);
        }
    }

    private extractSystemInstruction(messages: Message[]): string | undefined {
        const systems = messages.filter(m => m.role === 'system');
        if (systems.length === 0) return undefined;
        return systems.map(m => {
            if (typeof m.content === 'string') return m.content;
            if (m.content === null) return '';
            return m.content.map(c => (c as any).text).join('\n');
        }).join('\n');
    }

    private async formatHistory(messages: Message[], _options: import('../../types').MediaOptions = {}): Promise<{ history: any[], lastUserMessage: string | any[] }> {
        // Filter out system messages as they are handled via systemInstruction
        const conversation = messages.filter(m => m.role !== 'system');

        if (conversation.length === 0) {
            return { history: [], lastUserMessage: '' };
        }

        const lastMsg = conversation[conversation.length - 1];
        const historyMsgs = conversation.slice(0, conversation.length - 1);
        
        // Import media-utils lazily
        const { normalizeImagePart } = await import('../media-utils.js');

        const mapContentParts = async (content: any) => {
            if (typeof content === 'string') return [{ text: content }];
            if (content === null) return [];
            
            const parts = await Promise.all(content.map(async (p: any) => {
                if (p.type === 'text') return { text: p.text };
                
                if (p.type === 'image_data' || p.type === 'image_file' || p.type === 'image_url') {
                    // For Gemini, we convert everything to inlineData initially
                    // The SDK currently accepts inlineData for base64 images
                    try {
                        const { data, mimeType } = await normalizeImagePart(p);
                        return { inlineData: { mimeType, data } };
                    } catch (err) {
                        if (p.type === 'image_url') {
                            // Fallback for broken URLs 
                            return { text: `[Image: ${p.image_url.url}]` };
                        }
                        return { text: '[Unresolvable Image]' };
                    }
                }
                return null;
            }));
            
            return parts.filter(Boolean);
        };

        const history = await Promise.all(historyMsgs.map(async m => {
            if (m.role === 'tool' && m.tool_call_id) {
                return {
                    role: 'function',
                    parts: [{
                        functionResponse: {
                            name: this.sanitizeToolName(m.name || m.tool_call_id),
                            response: {
                                name: this.sanitizeToolName(m.name || m.tool_call_id),
                                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                            },
                        },
                    }],
                };
            }

            if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                const parts: any[] = [];
                if (typeof m.content === 'string' && m.content) {
                    parts.push({ text: m.content });
                } else if (Array.isArray(m.content)) {
                    const text = m.content.filter((p: any) => typeof p === 'object' && p.type === 'text').map((p: any) => p.text).join('\n');
                    if (text) parts.push({ text });
                }

                for (const tc of m.tool_calls) {
                    parts.push({
                        functionCall: {
                            name: this.sanitizeToolName(tc.function.name),
                            args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments,
                        }
                    });
                }

                return {
                    role: 'model',
                    parts: parts
                };
            }

            return {
                role: m.role === 'user' ? 'user' : 'model',
                parts: await mapContentParts(m.content)
            };
        }));

        const lastUserContent = typeof lastMsg.content === 'string' 
            ? lastMsg.content 
            : await mapContentParts(lastMsg.content);

        return { history, lastUserMessage: lastUserContent };
    }

    private handleError(error: any): Error {
        if (error.status === 429) return new RateLimitError(error.message, undefined, error);
        if (error.status >= 400 && error.status < 500) return new InvalidRequestError(error.message, error);
        if (error.message && error.message.includes('API key')) {
            return new AuthenticationError(error.message, error);
        }
        return new ProviderError(error.message || 'Gemini Error', 'GEMINI_ERROR', error.status || 500, error);
    }
}
