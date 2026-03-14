import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';
import { loadPuppeteer } from '../../utils/puppeteer-loader.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

async function execute(args: Record<string, any>): Promise<string> {
    const url = args.url as string;
    const format = (args.format || 'html') as 'html' | 'png';
    const viewport = args.viewport as { width?: number; height?: number } | undefined;
    const timeout = (args.timeout || 30000) as number;

    if (!url) {
        throw new Error('url is required');
    }

    const puppeteer = await loadPuppeteer();
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        await page.setViewport({
            width: viewport?.width || 1280,
            height: viewport?.height || 800
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout });

        if (format === 'png') {
            const buffer = await page.screenshot({ type: 'png', fullPage: true });
            let base64;
            // Puppeteer <20 returns Buffer, >=20 Uint8Array. Handle both gracefully
            if (Buffer.isBuffer(buffer)) {
                base64 = buffer.toString('base64');
            } else {
                base64 = Buffer.from(buffer).toString('base64');
            }
            return `data:image/png;base64,${base64}`;
        } else {
            const html = await page.content();
            return html;
        }
    } finally {
        await browser.close();
    }
}

export const webScreenshotTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
