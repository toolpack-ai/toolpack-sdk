import { ToolProject } from '../types.js';
import { httpGetTool } from './tools/get/index.js';
import { httpPostTool } from './tools/post/index.js';
import { httpPutTool } from './tools/put/index.js';
import { httpDeleteTool } from './tools/delete/index.js';
import { httpDownloadTool } from './tools/download/index.js';

export { httpGetTool } from './tools/get/index.js';
export { httpPostTool } from './tools/post/index.js';
export { httpPutTool } from './tools/put/index.js';
export { httpDeleteTool } from './tools/delete/index.js';
export { httpDownloadTool } from './tools/download/index.js';

export const httpToolsProject: ToolProject = {
    manifest: {
        key: 'http',
        name: 'http-tools',
        displayName: 'HTTP',
        version: '1.0.0',
        description: 'HTTP tools for making GET, POST, PUT, DELETE requests and downloading files.',
        author: 'Sajeer',
        tools: ['http.get', 'http.post', 'http.put', 'http.delete', 'http.download'],
        category: 'network',
    },
    tools: [httpGetTool, httpPostTool, httpPutTool, httpDeleteTool, httpDownloadTool],
    dependencies: {},
};
