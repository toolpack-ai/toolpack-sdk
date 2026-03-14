import { ToolProject } from '../types.js';
import { systemInfoTool } from './tools/info/index.js';
import { systemEnvTool } from './tools/env/index.js';
import { systemSetEnvTool } from './tools/set-env/index.js';
import { systemCwdTool } from './tools/cwd/index.js';
import { systemDiskUsageTool } from './tools/disk-usage/index.js';

export { systemInfoTool } from './tools/info/index.js';
export { systemEnvTool } from './tools/env/index.js';
export { systemSetEnvTool } from './tools/set-env/index.js';
export { systemCwdTool } from './tools/cwd/index.js';
export { systemDiskUsageTool } from './tools/disk-usage/index.js';

export const systemToolsProject: ToolProject = {
    manifest: {
        key: 'system',
        name: 'system-tools',
        displayName: 'System',
        version: '1.0.0',
        description: 'System tools for querying OS info, environment variables, working directory, and disk usage.',
        author: 'Sajeer',
        tools: [
            'system.info', 'system.env', 'system.set_env',
            'system.cwd', 'system.disk_usage',
        ],
        category: 'system',
    },
    tools: [
        systemInfoTool, systemEnvTool, systemSetEnvTool,
        systemCwdTool, systemDiskUsageTool,
    ],
    dependencies: {},
};
