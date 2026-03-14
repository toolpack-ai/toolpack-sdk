import { ToolProject } from '../types.js';
import { gitStatusTool } from './tools/status/index.js';
import { gitDiffTool } from './tools/diff/index.js';
import { gitLogTool } from './tools/log/index.js';
import { gitAddTool } from './tools/add/index.js';
import { gitCommitTool } from './tools/commit/index.js';
import { gitBlameTool } from './tools/blame/index.js';
import { gitBranchListTool } from './tools/branch-list/index.js';
import { gitBranchCreateTool } from './tools/branch-create/index.js';
import { gitCheckoutTool } from './tools/checkout/index.js';

export { gitStatusTool, gitDiffTool, gitLogTool, gitAddTool, gitCommitTool, gitBlameTool, gitBranchListTool, gitBranchCreateTool, gitCheckoutTool };

export const gitToolsProject: ToolProject = {
    manifest: {
        key: 'git',
        name: 'git-tools',
        displayName: 'Git Version Control',
        version: '1.0.0',
        description: 'Git operations for reading repository state, checking diffs, creating commits, and managing branches.',
        author: 'Sajeer',
        tools: [
            'git.status',
            'git.diff',
            'git.log',
            'git.add',
            'git.commit',
            'git.blame',
            'git.branch_list',
            'git.branch_create',
            'git.checkout'
        ],
        category: 'version-control',
    },
    tools: [
        gitStatusTool,
        gitDiffTool,
        gitLogTool,
        gitAddTool,
        gitCommitTool,
        gitBlameTool,
        gitBranchListTool,
        gitBranchCreateTool,
        gitCheckoutTool
    ],
    dependencies: {
        'simple-git': '^3.27.0',
    },
};
