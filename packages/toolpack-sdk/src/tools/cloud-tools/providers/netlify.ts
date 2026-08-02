import { NetlifyAPI } from 'netlify';

export class NetlifyProvider {
    /**
     * Helper to get an authenticated Netlify API client.
     * Looks for NETLIFY_AUTH_TOKEN in process.env.
     */
    static getClient(token?: string): NetlifyAPI {
        const resolved = token ?? process.env.NETLIFY_AUTH_TOKEN;
        if (!resolved) {
            throw new Error('NETLIFY_AUTH_TOKEN environment variable is required to use Netlify cloud tools.');
        }
        return new NetlifyAPI(resolved);
    }
}
