import { ToolParameters } from '../../../types.js';

export const name = 'fs.glob';
export const displayName = 'Glob Pattern Match';
export const description = 'Find files matching glob patterns (e.g., "**/*.ts", "src/**/*.test.js")';
export const category = 'filesystem';

export const parameters: ToolParameters = {
    type: 'object',
    properties: {
        pattern: {
            type: 'string',
            description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.json")',
        },
        cwd: {
            type: 'string',
            description: 'Root directory to search from (defaults to current working directory)',
        },
        ignore: {
            type: 'array',
            items: { type: 'string' },
            description: 'Patterns to ignore (e.g., ["node_modules/**", "dist/**"])',
        },
        onlyFiles: {
            type: 'boolean',
            description: 'Return only files, not directories (default: true)',
        },
        onlyDirectories: {
            type: 'boolean',
            description: 'Return only directories, not files (default: false)',
        },
        absolute: {
            type: 'boolean',
            description: 'Return absolute paths instead of relative (default: false)',
        },
    },
    required: ['pattern'],
};
