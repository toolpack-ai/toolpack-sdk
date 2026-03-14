import { execSync } from 'child_process';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const targetPath = (args.path || '/') as string;

    try {
        const output = execSync(`df -h "${targetPath}"`, {
            encoding: 'utf-8',
            timeout: 5000,
        });

        // Parse df output
        const lines = output.trim().split('\n');
        if (lines.length < 2) {
            return output;
        }

        const parts = lines[1].split(/\s+/);
        return JSON.stringify({
            path: targetPath,
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            usePercent: parts[4],
            mountedOn: parts[5],
        }, null, 2);
    } catch (error: any) {
        throw new Error(`Failed to get disk usage for ${targetPath}: ${error.message}`);
    }
}

export const systemDiskUsageTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
