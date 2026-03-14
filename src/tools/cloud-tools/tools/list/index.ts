import { ToolDefinition } from '../../../types.js';
import { cloudListSchema } from './schema.js';
import { NetlifyProvider } from '../../providers/netlify.js';

export const cloudListTool: ToolDefinition = {
    name: 'cloud.list',
    displayName: 'Cloud Deployments List',
    description: 'List recent deployments for a Netlify site.',
    category: 'cloud',
    parameters: cloudListSchema,
    execute: async (args: Record<string, unknown>) => {
        const siteId = args.siteId as string;
        const limit = (args.limit as number) || 5;

        try {
            const client = NetlifyProvider.getClient();

            // Note: the netlify package returns an array of deploy objects from this endpoint
            const deploys = await client.listSiteDeploys({
                site_id: siteId,
                page: 1,
                per_page: limit
            });

            // Netlify API typically returns the array directly, map to slim down output
            if (!Array.isArray(deploys)) {
                return 'Unexpected response format from Netlify API';
            }

            const slimDeploys = deploys.map(d => ({
                id: d.id,
                state: d.state,
                created_at: d.created_at,
                url: d.url,
                branch: d.branch,
                title: d.title
            }));

            return JSON.stringify(slimDeploys, null, 2);
        } catch (error: unknown) {
            return `Cloud list error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
