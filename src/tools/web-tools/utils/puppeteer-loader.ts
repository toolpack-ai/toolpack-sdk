/**
 * Lazy-loads Puppeteer to allow the web-tools to function
 * without requiring it to be installed.
 */
export async function loadPuppeteer() {
    try {
        const puppeteer = await import('puppeteer');
        return puppeteer.default || puppeteer;
    } catch (e: any) {
        throw new Error('Puppeteer is not installed. Please install it using `npm install puppeteer` to use this feature.');
    }
}
