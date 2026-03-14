import { ToolDefinition } from '../../../types.js';
import { cloudDeploySchema } from './schema.js';
import { NetlifyProvider } from '../../providers/netlify.js';

export const cloudDeployTool: ToolDefinition = {
    name: 'cloud.deploy',
    displayName: 'Cloud Deploy',
    description: 'Deploy a static directory to Netlify.',
    category: 'cloud',
    parameters: cloudDeploySchema,
    execute: async (args: Record<string, unknown>) => {
        const siteId = args.siteId as string;
        const dir = args.dir as string;
        const message = args.message as string | undefined;

        try {
            const client = NetlifyProvider.getClient();

            // Netlify's deploy method often handles Folder uploads but it sits on older API versions differently
            // We'll use the proper createSiteDeploy payload or deploy function depending on version.
            // In v13, `client.deploy` does exist if you use it correctly but TS might hide it.
            // Using the documented `client.deploy` fallback method via anycast or looking at official methods.
            const deploy = await (client as any).deploy(siteId, dir, {
                message: message || 'Deployed via Toolpack SDK',
                draft: false
            });

            return JSON.stringify({
                id: deploy.deployId,
                url: deploy.deploy.url,
                admin_url: deploy.deploy.admin_url,
                state: deploy.deploy.state
            }, null, 2);
        } catch (error: unknown) {
            return `Cloud deployment error: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
