import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaAdapter } from '../../src/providers/ollama';

vi.mock('../../src/providers/provider-logger', () => ({
    log: vi.fn(),
    safePreview: vi.fn(),
    logMessagePreview: vi.fn(),
    isVerbose: vi.fn(() => false),
    LOG_VERBOSE: false,
}));

vi.mock('http', () => {
    return {
        default: {
            request: vi.fn(),
        }
    };
});

// Assuming we extract the mock logic or just test formatting for now.
// Given Ollama uses raw http.request, it's easier to test the protected methods if exposed or trust the E2E.
// To keep it simple and given the time, I'll mock the internal `ollamaRequest` if possible, or just skip deep HTTP mocks here
// and rely on the fact that `toOllamaMessage` logic was the main change.

describe('OllamaAdapter', () => {
    describe('toOllamaMessage (via cast)', () => {
        it('formats tool calls and vision correctly', async () => {
            const adapter = new OllamaAdapter({ model: 'llama3.1' });

            // @ts-ignore - testing private method
            const msg1 = await adapter.toOllamaMessage({
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: '123',
                    type: 'function',
                    function: { name: 'fs.read', arguments: '{"path": "/"}' }
                }]
            });

            expect(msg1.role).toBe('assistant');
            expect(msg1.tool_calls[0].function.name).toBe('fs_read');
            expect(msg1.tool_calls[0].function.arguments).toEqual({ path: '/' });

            // @ts-ignore
            const msg2 = await adapter.toOllamaMessage({
                role: 'tool',
                content: 'result string',
                tool_call_id: '123',
                name: 'fs.read'
            });

            expect(msg2.role).toBe('tool');
            expect(msg2.content).toBe('result string');
            expect(msg2.tool_name).toBe('fs_read');

            // @ts-ignore
            const msg3 = await adapter.toOllamaMessage({
                role: 'user',
                content: [
                    { type: 'text', text: 'What is this?' },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo' } }
                ]
            });

            expect(msg3.content).toBe('What is this?');
            expect(msg3.images).toEqual(['iVBORw0KGgo']);
        });
    });
});
