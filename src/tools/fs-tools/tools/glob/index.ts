import fg from 'fast-glob';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const pattern = args.pattern as string;
    const cwd = args.cwd as string | undefined;
    const ignore = args.ignore as string[] | undefined;
    const onlyFiles = args.onlyFiles !== false;
    const onlyDirectories = args.onlyDirectories === true;
    const absolute = args.absolute === true;

    if (!pattern) {
        throw new Error('pattern is required');
    }

    // Normalize pattern to use forward slashes (fast-glob requires this on Windows)
    const normalizedPattern = pattern.replace(/\\/g, '/');

    try {
        const files = await fg(normalizedPattern, {
            cwd: cwd || process.cwd(),
            ignore: ignore || ['node_modules/**', '.git/**'],
            onlyFiles,
            onlyDirectories,
            absolute,
            dot: true,
        });

        return JSON.stringify({
            pattern,
            files,
            count: files.length,
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to glob pattern "${pattern}": ${error.message}`);
    }
}

export const fsGlobTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
