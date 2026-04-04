import type { ToolProject } from "../types.js";
import { fsReadFileTool } from './tools/read-file/index.js';
import { fsWriteFileTool } from './tools/write-file/index.js';
import { fsAppendFileTool } from './tools/append-file/index.js';
import { fsDeleteFileTool } from './tools/delete-file/index.js';
import { fsExistsTool } from './tools/exists/index.js';
import { fsStatTool } from './tools/stat/index.js';
import { fsListDirTool } from './tools/list-dir/index.js';
import { fsCreateDirTool } from './tools/create-dir/index.js';
import { fsMoveTool } from './tools/move/index.js';
import { fsCopyTool } from './tools/copy/index.js';
import { fsReadFileRangeTool } from './tools/read-file-range/index.js';
import { fsSearchTool } from './tools/search/index.js';
import { fsReplaceInFileTool } from './tools/replace-in-file/index.js';
import { fsTreeTool } from './tools/tree/index.js';
import { fsGlobTool } from './tools/glob/index.js';
import { fsDeleteDirTool } from './tools/delete-dir/index.js';
import { fsBatchReadTool } from './tools/batch-read/index.js';
import { fsBatchWriteTool } from './tools/batch-write/index.js';

export { fsReadFileTool } from './tools/read-file/index.js';
export { fsWriteFileTool } from './tools/write-file/index.js';
export { fsAppendFileTool } from './tools/append-file/index.js';
export { fsDeleteFileTool } from './tools/delete-file/index.js';
export { fsExistsTool } from './tools/exists/index.js';
export { fsStatTool } from './tools/stat/index.js';
export { fsListDirTool } from './tools/list-dir/index.js';
export { fsCreateDirTool } from './tools/create-dir/index.js';
export { fsMoveTool } from './tools/move/index.js';
export { fsCopyTool } from './tools/copy/index.js';
export { fsReadFileRangeTool } from './tools/read-file-range/index.js';
export { fsSearchTool } from './tools/search/index.js';
export { fsReplaceInFileTool } from './tools/replace-in-file/index.js';
export { fsTreeTool } from './tools/tree/index.js';
export { fsGlobTool } from './tools/glob/index.js';
export { fsDeleteDirTool } from './tools/delete-dir/index.js';
export { fsBatchReadTool } from './tools/batch-read/index.js';
export { fsBatchWriteTool } from './tools/batch-write/index.js';

export const fsToolsProject: ToolProject = {
    manifest: {
        key: 'fs',
        name: 'fs-tools',
        displayName: 'File System',
        version: '1.0.0',
        description: 'File system tools for reading, writing, searching, and managing files and directories.',
        author: 'Sajeer',
        tools: [
            'fs.read_file', 'fs.write_file', 'fs.append_file', 'fs.delete_file',
            'fs.exists', 'fs.stat', 'fs.list_dir', 'fs.create_dir',
            'fs.move', 'fs.copy', 'fs.read_file_range', 'fs.search',
            'fs.replace_in_file', 'fs.tree', 'fs.glob', 'fs.delete_dir',
            'fs.batch_read', 'fs.batch_write',
        ],
        category: 'filesystem',
    },
    tools: [
        fsReadFileTool, fsWriteFileTool, fsAppendFileTool, fsDeleteFileTool,
        fsExistsTool, fsStatTool, fsListDirTool, fsCreateDirTool,
        fsMoveTool, fsCopyTool, fsReadFileRangeTool, fsSearchTool,
        fsReplaceInFileTool, fsTreeTool, fsGlobTool, fsDeleteDirTool,
        fsBatchReadTool, fsBatchWriteTool,
    ],
    dependencies: {
        'fast-glob': '^3.3.2',
    },
};
