/**
 * Lazy-loads rss-parser to allow the web-tools to function
 * without requiring it to be installed.
 */
export async function loadRssParser() {
    try {
        const Parser = await import('rss-parser');
        return new (Parser.default || Parser)();
    } catch (e: any) {
        throw new Error('rss-parser is not installed. Please install it using `npm install rss-parser` to use this feature.');
    }
}
