import { ToolProject } from '../types.js';
import { execRunTool } from './tools/run/index.js';
import { execRunShellTool } from './tools/run-shell/index.js';
import { execRunBackgroundTool } from './tools/run-background/index.js';
import { execReadOutputTool } from './tools/read-output/index.js';
import { execKillTool } from './tools/kill/index.js';
import { execListProcessesTool } from './tools/list-processes/index.js';

export { execRunTool } from './tools/run/index.js';
export { execRunShellTool } from './tools/run-shell/index.js';
export { execRunBackgroundTool } from './tools/run-background/index.js';
export { execReadOutputTool } from './tools/read-output/index.js';
export { execKillTool } from './tools/kill/index.js';
export { execListProcessesTool } from './tools/list-processes/index.js';

export const execToolsProject: ToolProject = {
    manifest: {
        key: 'exec',
        name: 'exec-tools',
        displayName: 'Execution',
        version: '1.0.0',
        description: 'Code execution tools for running commands, managing background processes, and automation.',
        author: 'Sajeer',
        tools: [
            'exec.run', 'exec.run_shell', 'exec.run_background',
            'exec.read_output', 'exec.kill', 'exec.list_processes',
        ],
        category: 'execution',
    },
    tools: [
        execRunTool, execRunShellTool, execRunBackgroundTool,
        execReadOutputTool, execKillTool, execListProcessesTool,
    ],
    dependencies: {},
};
