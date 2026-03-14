import { Toolchain, ImageFilePart, ImageDataPart, ImageUrlPart, readFileAsBase64 } from '../../src';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// -----------------------------------------------------------------------------
// Note: You must build the SDK first (`npm run build`) for this example to run 
// properly if executing via node, or run it via tsx/ts-node.
// -----------------------------------------------------------------------------

async function main() {
    // 1. Initialize Toolchain
    const tc = Toolchain.init({
        providers: {
            openai: { apiKey: process.env.OPENAI_API_KEY || 'sk-...' },
        },
        defaultProvider: 'openai'
    });

    console.log('--- Multimodal Image Example ---');

    // 2. Create a dummy image file for demonstration purposes
    const tmpDir = os.tmpdir();
    const mockImagePath = path.join(tmpDir, 'mock_image.png');
    
    // Create a 1x1 transparent PNG file
    const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    fs.writeFileSync(mockImagePath, Buffer.from(transparentPngBase64, 'base64'));
    
    console.log(`Created mock image at: ${mockImagePath}`);

    //
    // Usage 1: Using an ImageFilePart (Local File)
    // The SDK will automatically read this file, extract the mime type, 
    // and convert it into a base64 inline string for the provider.
    //
    console.log('\n[1] Sending ImageFilePart...');
    const filePart: ImageFilePart = {
        type: 'image_file',
        image_file: { path: mockImagePath }
    };

    try {
        const res1 = await tc.generate({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'user', content: [
                    { type: 'text', text: 'What is in this tiny transparent image?' },
                    filePart
                ]}
            ]
        });
        console.log('Response:', res1.content);
    } catch (err: any) {
        console.error('Error (ImageFilePart):', err.message);
    }

    //
    // Usage 2: Using an ImageDataPart (Base64)
    // If you already have the file in memory in base64 format.
    // We can use the exposed readFileAsBase64 utility to help us. 
    //
    console.log('\n[2] Sending ImageDataPart...');
    const { data: base64Data, mimeType } = await readFileAsBase64(mockImagePath);
    
    const dataPart: ImageDataPart = {
        type: 'image_data',
        image_data: { 
            data: base64Data, 
            mimeType: mimeType 
        }
    };

    try {
        const res2 = await tc.generate({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'user', content: [
                    { type: 'text', text: 'What is the color of this image?' },
                    dataPart
                ]}
            ]
        });
        console.log('Response:', res2.content);
    } catch (err: any) {
        console.error('Error (ImageDataPart):', err.message);
    }

    //
    // Usage 3: Using an ImageUrlPart (Remote HTTP URL)
    // Providers like OpenAI natively support HTTP URLs. The SDK passes it through.
    // For providers that don't (like Anthropic), the SDK will automatically 
    // download the image and send it as base64 inline format.
    //
    console.log('\n[3] Sending ImageUrlPart...');
    const urlPart: ImageUrlPart = {
        type: 'image_url',
        image_url: { url: 'https://upload.wikimedia.org/wikipedia/commons/ca/ca3/1x1.png' }
    };

    try {
        const res3 = await tc.generate({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'user', content: [
                    { type: 'text', text: 'Describe the pixels in this image.' },
                    urlPart
                ]}
            ]
        });
        console.log('Response:', res3.content);
    } catch (err: any) {
        console.error('Error (ImageUrlPart):', err.message);
    }

    // Cleanup
    if (fs.existsSync(mockImagePath)) {
        fs.unlinkSync(mockImagePath);
        console.log(`\nCleaned up mock image: ${mockImagePath}`);
    }
}

main().catch(console.error);
