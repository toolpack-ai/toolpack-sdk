import { ToolProject } from '../types.js';
import { diffCreateTool } from './tools/create/index.js';
import { diffApplyTool } from './tools/apply/index.js';
import { diffPreviewTool } from './tools/preview/index.js';

export { diffCreateTool, diffApplyTool, diffPreviewTool };

export const diffToolsProject: ToolProject = {
    manifest: {
        key: 'diff',
        name: 'diff-tools',
        displayName: 'Diff and Patch',
        version: '1.0.0',
        description: 'Tools to create and apply unified diff changes to files safely.',
        author: 'Sajeer',
        tools: [
            'diff.create',
            'diff.apply',
            'diff.preview'
        ],
        category: 'diff',
    },
    tools: [
        diffCreateTool,
        diffApplyTool,
        diffPreviewTool
    ],
    dependencies: {
        'diff': '^7.0.0',
    },
};
