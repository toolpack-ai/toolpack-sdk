import { ToolDefinition } from '../../../types.js';
import { cloudStatusSchema } from './schema.js';
import { NetlifyProvider } from '../../providers/netlify.js';

export const cloudStatusTool: ToolDefinition = {
    name: 'cloud.status',
    displayName: 'Cloud Status',
    description: 'Check the status of a specific Netlify deployment.',
    category: 'cloud',
    parameters: cloudStatusSchema,
    execute: async (args: Record<string, unknown>) => {
        const siteId = args.siteId as string;
        const deployId = args.deployId as string;

        try {
            const client = NetlifyProvider.getClient();
            const deploy = await client.getSiteDeploy({ site_id: siteId, deploy_id: deployId });

            return JSON.stringify({
                id: deploy.id,
                state: deploy.state,
                error_message: deploy.error_message,
                created_at: deploy.created_at,
                updated_at: deploy.updated_at,
                url: deploy.url
            }, null, 2);
        } catch (error: unknown) {
            return `Cloud status error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
