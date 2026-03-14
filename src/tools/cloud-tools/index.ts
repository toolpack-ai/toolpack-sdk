import { ToolProject } from '../types.js';
import { cloudDeployTool } from './tools/deploy/index.js';
import { cloudStatusTool } from './tools/status/index.js';
import { cloudListTool } from './tools/list/index.js';

export { cloudDeployTool, cloudStatusTool, cloudListTool };

export const cloudToolsProject: ToolProject = {
    manifest: {
        key: 'cloud',
        name: 'cloud-tools',
        displayName: 'Cloud Deployment',
        version: '1.0.0',
        description: 'Cloud deployment operations allowing the AI to publish directories directly to the internet.',
        author: 'Sajeer',
        tools: [
            'cloud.deploy',
            'cloud.status',
            'cloud.list'
        ],
        category: 'cloud',
    },
    tools: [
        cloudDeployTool,
        cloudStatusTool,
        cloudListTool
    ],
    dependencies: {
        'netlify': '^13.1.20',
    },
};
