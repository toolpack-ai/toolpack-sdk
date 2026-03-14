import { ToolProject } from '../types.js';
import { dbQueryTool } from './tools/query/index.js';
import { dbSchemaTool } from './tools/schema/index.js';
import { dbTablesTool } from './tools/tables/index.js';
import { dbInsertTool } from './tools/insert/index.js';
import { dbUpdateTool } from './tools/update/index.js';
import { dbDeleteTool } from './tools/delete/index.js';
import { dbCountTool } from './tools/count/index.js';

export {
    dbQueryTool,
    dbSchemaTool,
    dbTablesTool,
    dbInsertTool,
    dbUpdateTool,
    dbDeleteTool,
    dbCountTool
};

export const dbToolsProject: ToolProject = {
    manifest: {
        key: 'db',
        name: 'db-tools',
        displayName: 'Database Tools',
        version: '1.0.0',
        description: 'Stateless database operations enabling the AI to interact with local databases.',
        author: 'Sajeer',
        tools: [
            'db.query',
            'db.schema',
            'db.tables',
            'db.insert',
            'db.update',
            'db.delete',
            'db.count'
        ],
        category: 'database',
    },
    tools: [
        dbQueryTool,
        dbSchemaTool,
        dbTablesTool,
        dbInsertTool,
        dbUpdateTool,
        dbDeleteTool,
        dbCountTool
    ],
    dependencies: {
        'better-sqlite3': '^11.3.0',
    },
};
