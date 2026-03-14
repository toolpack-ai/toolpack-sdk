import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Toolpack, ImageFilePart, ImageDataPart, ImageUrlPart, readFileAsBase64 } from '../../src';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test configuration from environment
const testConfig = {
    openai: process.env.TOOLPACK_OPENAI_KEY,
    anthropic: process.env.TOOLPACK_ANTHROPIC_KEY,
    gemini: process.env.TOOLPACK_GEMINI_KEY,
};

// Use the test image asset
function getTestImagePath(): string {
    return path.join(__dirname, 'assets', 'IntegrationTest-V1.0-IMG-001.png');
}

// Test image URL (TODO: Replace with a more reliable image URL)
// The 1x1.png is too small and causes null responses
const TEST_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png';

describe('Multimodal Image Tests', () => {
    let testImagePath: string;
    let testImageData: { data: string; mimeType: string };

    beforeAll(async () => {
        testImagePath = getTestImagePath();
        testImageData = await readFileAsBase64(testImagePath);
    });

    describe('OpenAI', () => {
        it('should handle ImageFilePart', async () => {
            if (!testConfig.openai) {
                console.log('⏭ Skipping OpenAI test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    openai: { apiKey: testConfig.openai },
                },
                defaultProvider: 'openai',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            // First test with text only to verify API works
            console.log('Testing text-only request first...');
            const textResult = await tc.generate({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'user', content: 'What is 2+2?' }
                ],
                tools: undefined
            }, 'openai');
            console.log('Text-only result:', textResult.content);
            expect(textResult.content).toBeTruthy();

            const filePart: ImageFilePart = {
                type: 'image_file',
                image_file: { path: testImagePath }
            };

            const result = await tc.generate({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What text do you see in this image? Please read all the text.' },
                        filePart
                    ]}
                ],
                tools: undefined
            }, 'openai');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
            // Verify the AI can read the actual content from the test image
            if (result.content) {
                expect(result.content.toLowerCase()).toContain('integration test');
            }
        }, 30000);

        it('should handle ImageDataPart', async () => {
            if (!testConfig.openai) {
                console.log('⏭ Skipping OpenAI test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    openai: { apiKey: testConfig.openai },
                },
                defaultProvider: 'openai',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            const dataPart: ImageDataPart = {
                type: 'image_data',
                image_data: { 
                    data: testImageData.data, 
                    mimeType: testImageData.mimeType 
                }
            };

            const result = await tc.generate({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What text do you see in this image? Please read all the text.' },
                        dataPart
                    ]}
                ]
            }, 'openai');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
            // Verify the AI can read the actual content from the test image
            if (result.content) {
                expect(result.content.toLowerCase()).toContain('integration test');
            }
        }, 30000);

        it('should handle ImageUrlPart', async () => {
            if (!testConfig.openai) {
                console.log('⏭ Skipping OpenAI test - no API key'); 
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    openai: { apiKey: testConfig.openai },
                },
                defaultProvider: 'openai'
            });

            const urlPart: ImageUrlPart = {
                type: 'image_url',
                image_url: { url: TEST_IMAGE_URL }
            };

            const result = await tc.generate({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'Describe what you see in this image.' },
                        urlPart
                    ]}
                ]
            }, 'openai');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
            // This is an external URL test, just verify we get a response
        }, 30000);

        it('should support file upload API', async () => {
            if (!testConfig.openai) {
                console.log('⏭ Skipping OpenAI test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    openai: { apiKey: testConfig.openai },
                },
                defaultProvider: 'openai'
            });

            const provider = tc.getProvider('openai');
            expect(provider.supportsFileUpload()).toBe(true);

            const uploadResult = await provider.uploadFile({
                filePath: testImagePath,
                mimeType: 'image/png',
                purpose: 'vision'
            });

            expect(uploadResult.id).toBeTruthy();
            expect(typeof uploadResult.id).toBe('string');

            // Clean up
            await provider.deleteFile(uploadResult.id);
        }, 30000);
    });

    describe('Anthropic', () => {
        it('should handle ImageFilePart', async () => {
            if (!testConfig.anthropic) {
                console.log('⏭ Skipping Anthropic test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    anthropic: { apiKey: testConfig.anthropic },
                },
                defaultProvider: 'anthropic',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            const filePart: ImageFilePart = {
                type: 'image_file',
                image_file: { path: testImagePath }
            };

            const result = await tc.generate({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What text do you see in this image? Please read all the text.' },
                        filePart
                    ]}
                ]
            }, 'anthropic');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
            // Verify the AI can read the actual content from the test image
            if (result.content) {
                expect(result.content.toLowerCase()).toContain('integration test');
            }
        }, 30000);

        it('should handle ImageDataPart', async () => {
            if (!testConfig.anthropic) {
                console.log('⏭ Skipping Anthropic test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    anthropic: { apiKey: testConfig.anthropic },
                },
                defaultProvider: 'anthropic',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            const dataPart: ImageDataPart = {
                type: 'image_data',
                image_data: { 
                    data: testImageData.data, 
                    mimeType: testImageData.mimeType 
                }
            };

            const result = await tc.generate({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What text do you see in this image? Please read all the text.' },
                        dataPart
                    ]}
                ]
            }, 'anthropic');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
            // Verify the AI can read the actual content from the test image
            if (result.content) {
                expect(result.content.toLowerCase()).toContain('integration test');
            }
        }, 30000);

        it('should handle ImageUrlPart', async () => {
            if (!testConfig.anthropic) {
                console.log('⏭ Skipping Anthropic test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    anthropic: { apiKey: testConfig.anthropic },
                },
                defaultProvider: 'anthropic'
            });

            const urlPart: ImageUrlPart = {
                type: 'image_url',
                image_url: { url: TEST_IMAGE_URL }
            };

            const result = await tc.generate({
                model: 'claude-haiku-4-5-20251001',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What is the size of this image?' },
                        urlPart
                    ]}
                ]
            }, 'anthropic');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
        }, 30000);

        // TODO: Fix Anthropic file upload - this.client.files is undefined
        it.skip('should support file upload API (experimental)', async () => {
            if (!testConfig.anthropic) {
                console.log('⏭ Skipping Anthropic test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    anthropic: { apiKey: testConfig.anthropic },
                },
                defaultProvider: 'anthropic'
            });

            const provider = tc.getProvider('anthropic');
            expect(provider.supportsFileUpload()).toBe(true);

            const uploadResult = await provider.uploadFile({
                filePath: testImagePath,
                mimeType: 'image/png',
                purpose: 'vision'
            });

            expect(uploadResult.id).toBeTruthy();
            expect(typeof uploadResult.id).toBe('string');

            // Clean up
            await provider.deleteFile(uploadResult.id);
        }, 30000);
    });

    describe('Gemini', () => {
        it('should handle ImageFilePart', async () => {
            if (!testConfig.gemini) {
                console.log('⏭ Skipping Gemini test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    gemini: { apiKey: testConfig.gemini },
                },
                defaultProvider: 'gemini',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            const filePart: ImageFilePart = {
                type: 'image_file',
                image_file: { path: testImagePath }
            };

            const result = await tc.generate({
                model: 'gemini-3.1-flash-lite-preview',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What text do you see in this image? Please read all the text.' },
                        filePart
                    ]}
                ]
            }, 'gemini');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
            // Verify the AI can read the actual content from the test image
            if (result.content) {
                expect(result.content.toLowerCase()).toContain('integration test');
            }
        }, 30000);

        it('should handle ImageDataPart', async () => {
            if (!testConfig.gemini) {
                console.log('⏭ Skipping Gemini test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    gemini: { apiKey: testConfig.gemini },
                },
                defaultProvider: 'gemini',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            const dataPart: ImageDataPart = {
                type: 'image_data',
                image_data: { 
                    data: testImageData.data, 
                    mimeType: testImageData.mimeType 
                }
            };

            const result = await tc.generate({
                model: 'gemini-3.1-flash-lite-preview',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What text do you see in this image? Please read all the text.' },
                        dataPart
                    ]}
                ]
            }, 'gemini');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
            // Verify the AI can read the actual content from the test image
            if (result.content) {
                expect(result.content.toLowerCase()).toContain('integration test');
            }
        }, 30000);

        it('should handle ImageUrlPart', async () => {
            if (!testConfig.gemini) {
                console.log('⏭ Skipping Gemini test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    gemini: { apiKey: testConfig.gemini },
                },
                defaultProvider: 'gemini',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            const urlPart: ImageUrlPart = {
                type: 'image_url',
                image_url: { url: TEST_IMAGE_URL }
            };

            const result = await tc.generate({
                model: 'gemini-3.1-flash-lite-preview',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'What is the size of this image?' },
                        urlPart
                    ]}
                ]
            }, 'gemini');

            expect(result.content).toBeTruthy();
            expect(typeof result.content).toBe('string');
        }, 30000);

        // TODO: Fix Gemini file upload - multipart form data issue
        it.skip('should support file upload API', async () => {
            if (!testConfig.gemini) {
                console.log('⏭ Skipping Gemini test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    gemini: { apiKey: testConfig.gemini },
                },
                defaultProvider: 'gemini',
                disableBaseContext: true,
                defaultMode: 'chat'
            });

            const provider = tc.getProvider('gemini');
            expect(provider.supportsFileUpload()).toBe(true);

            const uploadResult = await provider.uploadFile({
                filePath: testImagePath,
                mimeType: 'image/png'
            });

            expect(uploadResult.id).toBeTruthy();
            expect(typeof uploadResult.id).toBe('string');

            // Clean up
            await provider.deleteFile(uploadResult.id);
        }, 30000);
    });

    describe('Ollama (Local)', () => {
        it('should handle ImageFilePart if vision model is available', async () => {
            // Check available models first
            const response = await fetch('http://localhost:11434/api/tags');
            if (!response.ok) {
                console.log('⏭ Skipping Ollama test - not running');
                return;
            }
            
            const models = await response.json() as any;
            const visionModels = models.models.filter((m: any) => 
                m.name.includes('llava') || 
                m.name.includes('vision') || 
                m.name.includes('moondream') ||
                m.name.includes('bakllava') ||
                m.families?.includes('clip')
            );

            if (visionModels.length === 0) {
                console.log('⏭ Skipping Ollama test - no vision model available');
                return;
            }

            const visionModel = visionModels[0].name;
            
            const tc = await Toolpack.init({
                providers: {
                    ollama: { 
                        baseUrl: 'http://localhost:11434',
                        model: visionModel
                    },
                },
                defaultProvider: 'ollama'
            });

            const filePart: ImageFilePart = {
                type: 'image_file',
                image_file: { path: testImagePath }
            };

            try {
                const result = await tc.generate({
                    model: visionModel,
                    messages: [
                        { role: 'user', content: [
                            { type: 'text', text: 'What color is this image?' },
                            filePart
                        ]}
                    ],
                    tools: undefined,
                    tool_choice: undefined
                }, 'ollama');

                expect(result.content).toBeTruthy();
                expect(typeof result.content).toBe('string');
            } catch (err: any) {
                if (err.message.includes('not pulled')) {
                    console.log('⏭ Skipping Ollama test - vision model not available');
                    return;
                }
                throw err;
            }
        }, 30000);

        it('should not support file upload API', async () => {
            // Get any available model
            const response = await fetch('http://localhost:11434/api/tags');
            if (!response.ok) {
                console.log('⏭ Skipping Ollama test - not running');
                return;
            }
            
            const models = await response.json() as any;
            if (models.models.length === 0) {
                console.log('⏭ Skipping Ollama test - no models available');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    ollama: { 
                        baseUrl: 'http://localhost:11434',
                        model: models.models[0].name
                    },
                },
                defaultProvider: 'ollama'
            });

            const provider = tc.getProvider('ollama');
            expect(provider.supportsFileUpload()).toBe(false);
        });
    });

    describe('Media Options', () => {
        it('should respect mediaOptions in requests', async () => {
            if (!testConfig.openai) {
                console.log('⏭ Skipping media options test - no API key');
                return;
            }

            const tc = await Toolpack.init({
                providers: {
                    openai: { apiKey: testConfig.openai },
                },
                defaultProvider: 'openai'
            });

            const dataPart: ImageDataPart = {
                type: 'image_data',
                image_data: { 
                    data: testImageData.data, 
                    mimeType: testImageData.mimeType 
                }
            };

            const result = await tc.generate({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'user', content: [
                        { type: 'text', text: 'Describe this image' },
                        dataPart
                    ]}
                ],
                mediaOptions: {
                    uploadStrategy: 'inline',
                    maxInlineSize: 5 * 1024 * 1024 // 5MB
                }
            }, 'openai');

            expect(result.content).toBeTruthy();
        }, 30000);
    });
});
